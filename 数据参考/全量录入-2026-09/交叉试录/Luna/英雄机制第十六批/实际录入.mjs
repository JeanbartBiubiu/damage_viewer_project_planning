import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

// 第十六批实际录入器。默认只读预检；只有 --apply、显式确认值和全部冻结校验通过时才允许创建候选缺项。
// 只允许参数、公式、效果三类组成；角色主体、技能关系、图片和其余三类组成永不写入。
const herePath = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidateFile = '完整候选-修订版2.json';
const candidateVersionFile = '候选版本-修订版2.json';
const planFile = '写前计划-修订版2.json';
const freezeFile = '冻结候选锁-修订版2.json';
const originalFile = '写前现值.json';
const mediaFile = '关联与图片保护快照-终稿.json';
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
const writableKinds = new Set(['parameters', 'formulas', 'effects']);
const catalogKinds = [
  ['attributes', 'attributeKey'],
  ['modifier-zones', 'modifierZoneKey'],
  ['damage-types', 'damageTypeKey'],
  ['statuses', 'statusKey'],
];
const schema = {
  parameterValueTypes: new Set(['INTEGER', 'DECIMAL']),
  parameterValueModes: new Set(['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL', 'RUNTIME_INPUT']),
  nodeTypes: new Set(['PARAMETER', 'ATTRIBUTE', 'OPERATION']),
  operations: new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']),
  resultTypes: new Set(['RESOURCE_CHANGE']),
  resourceOperations: new Set(['CONSUME', 'RESTORE']),
};
const expected = {
  candidateSha256: '1e8809bc4c69d42a4b947f9d533e51bdb8e53d4ff04153091ec7cbadbda643bc',
  candidateVersionSha256: '6f12f66530b3ddb4d4ac7c69379348d6f018079f84a80a7d005b9bd02bb9d2e8',
  candidatePlanSha256: 'f25f8452a29624f8e5e4a19b7a080a6212bfcb27f2baa50557f4462e0c7fe06e',
  writePlanSha256: '6c2e687d3aaa74401d07fe200fa1c4bfe022f183a51f2d20d3492ba41d90b022',
  freezeSha256: 'e4c8fa637700b666a885b9fa1500e164d511a1ce3344c05e443d5444f05a9f75',
  originalSha256: '4f4c30ab1768b20f3d1f762b9fb73d96baebba8e4c70870d4bdfbf849725b339',
  mediaSha256: 'bc2e2cbc99cc940644e05ed575467a143c146eb5e17ef01f7bca593b67e78938',
  counts: { parameters: 115, formulas: 21, effects: 17, processes: 0, internalStates: 0, triggerRules: 0 },
  reusedPublicParameters: 22,
  newComponents: 131,
};
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const readBytes = file => fs.readFileSync(file);
const readJson = file => JSON.parse(readBytes(file));
const filePath = name => path.join(herePath, name);
const rows = response => Array.isArray(response?.data) ? response.data : Array.isArray(response?.data?.items) ? response.data.items : [];
const idField = kind => kinds.find(item => item[0] === kind)?.[1];
const apiKind = kind => kinds.find(item => item[0] === kind)?.[2];
const businessCanonical = value => Array.isArray(value)
  ? value.map(businessCanonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => !serverFields.has(key)).sort().map(key => [key, businessCanonical(value[key])]))
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
const businessDiff = (expectedValue, actualValue) => diff(businessCanonical(expectedValue), businessCanonical(actualValue));
const exactDiff = (expectedValue, actualValue) => diff(exactCanonical(expectedValue), exactCanonical(actualValue));
const parameterValue = value => ({ valueType: value?.valueType, valueMode: value?.valueMode, fixedValue: value?.fixedValue, levelValues: value?.levelValues });
const parameterValueDiff = (expectedValue, actualValue) => diff(parameterValue(expectedValue), parameterValue(actualValue));
const listSummaryDiff = (item, detail) => {
  if (!item || !detail) return null;
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
const normalizedKey = (skillKey, kind, id) => `${skillKey}/${kind}/${id}`;
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw Error('只接受默认只读预检或 --apply');
const apply = args.includes('--apply');
if (apply && process.env.HERO16_APPLY_CONFIRM !== 'CONFIRM_HERO16_COMPONENT_POSTS') throw Error('实际POST需要显式设置 HERO16_APPLY_CONFIRM=CONFIRM_HERO16_COMPONENT_POSTS；当前保持只读预检');

const candidateBytes = readBytes(filePath(candidateFile));
const candidateVersionBytes = readBytes(filePath(candidateVersionFile));
const planBytes = readBytes(filePath(planFile));
const freezeBytes = readBytes(filePath(freezeFile));
const originalBytes = readBytes(filePath(originalFile));
const mediaBytes = readBytes(filePath(mediaFile));
const candidate = JSON.parse(candidateBytes);
const candidateVersion = JSON.parse(candidateVersionBytes);
const plan = JSON.parse(planBytes);
const freeze = JSON.parse(freezeBytes);
const original = JSON.parse(originalBytes);
const media = JSON.parse(mediaBytes);
const staticChecks = [];
const staticFailures = [];
const staticCheck = (name, passed, detail = null) => {
  const result = { name, passed: Boolean(passed), detail };
  staticChecks.push(result);
  if (!result.passed) staticFailures.push(result);
  return result.passed;
};
staticCheck('候选文件冻结', sha256(candidateBytes) === expected.candidateSha256, sha256(candidateBytes));
staticCheck('候选版本文件冻结', sha256(candidateVersionBytes) === expected.candidateVersionSha256, sha256(candidateVersionBytes));
staticCheck('写前计划文件冻结', sha256(planBytes) === expected.writePlanSha256, sha256(planBytes));
staticCheck('修订版2冻结锁冻结', sha256(freezeBytes) === expected.freezeSha256, sha256(freezeBytes));
staticCheck('写前现值冻结', sha256(originalBytes) === expected.originalSha256, sha256(originalBytes));
staticCheck('关联与图片保护快照冻结', sha256(mediaBytes) === expected.mediaSha256, sha256(mediaBytes));
staticCheck('候选关联哈希一致', candidateVersion.fileSha256 === expected.candidateSha256 && plan.candidateSha256 === expected.candidateSha256 && freeze.candidateSha256 === expected.candidateSha256, { candidateVersion: candidateVersion.fileSha256, plan: plan.candidateSha256, freeze: freeze.candidateSha256 });
staticCheck('候选计划哈希一致', candidateVersion.planSha256 === expected.candidatePlanSha256 && plan.candidatePlanSha256 === expected.candidatePlanSha256 && freeze.candidatePlanSha256 === expected.candidatePlanSha256, { candidateVersion: candidateVersion.planSha256, plan: plan.candidatePlanSha256, freeze: freeze.candidatePlanSha256 });
staticCheck('候选来源与接口策略冻结', candidate.meta?.apiWrites === 0 && plan.policy?.businessWrites === 0 && plan.policy?.apiCalls === 0 && plan.policy?.endpoint === apiBase && freeze.apiWrites === 0 && freeze.businessWrites === 0, null);
staticCheck('候选技能槽精确20项', equal(Object.keys(candidate.skills ?? {}), skills), Object.keys(candidate.skills ?? {}));
staticCheck('候选版本和锁均为父负责人审查前状态', freeze.status === 'READY_FOR_PARENT_REVIEW' && freeze.parentAction?.includes('不授权任何业务写入') === true, freeze.parentAction);
const candidateCounts = Object.fromEntries(kinds.map(([kind]) => [kind, skills.reduce((sum, skillKey) => sum + (candidate.skills[skillKey]?.write?.[kind]?.length ?? 0), 0)]));
staticCheck('候选六类计数冻结', equal(candidateCounts, expected.counts) && equal(candidateVersion.counts, expected.counts) && equal(freeze.counts, expected.counts), candidateCounts);
const totalCandidateComponents = Object.values(candidateCounts).reduce((sum, value) => sum + value, 0);
staticCheck('候选组成总数与复用/新增一致', totalCandidateComponents === 153 && totalCandidateComponents - expected.reusedPublicParameters === expected.newComponents, { totalCandidateComponents, reused: expected.reusedPublicParameters, newComponents: expected.newComponents });
staticCheck('写前计划131项且全是POST', plan.requests?.length === expected.newComponents && plan.requests.every(item => item.method === 'POST'), { requestCount: plan.requests?.length, methods: [...new Set((plan.requests ?? []).map(item => item.method))] });
staticCheck('当前保护GET冻结为166次全200', plan.currentGet?.requestCount === 166 && plan.currentGet?.errorCount === 0 && original.summary?.requestCount === 166 && original.summary?.errorCount === 0 && original.requests?.every(item => item.status === 200), original.summary);
staticCheck('历史关联图片保护为28次只读', media.success === true && media.summary?.requests === 28 && media.summary?.apiWrites === 0 && media.requests?.length === 28, media.summary);

const historicalDetails = new Map();
const historicalLists = new Map();
for (const skillKey of skills) {
  for (const [kind, key] of kinds) {
    const component = original.skills?.[skillKey]?.components?.[kind];
    const items = component?.items ?? rows(component?.list);
    historicalLists.set(`${skillKey}/${kind}`, items);
    for (const entry of component?.details ?? []) {
      const id = entry.key ?? entry.item?.[key] ?? entry.detail?.data?.[key] ?? entry.data?.[key];
      const data = entry.detail?.data ?? entry.data;
      if (id && data) historicalDetails.set(normalizedKey(skillKey, kind, id), data);
    }
  }
}
staticCheck('写前保护详情22项', historicalDetails.size === 22 && original.summary?.detailCount === 22, { details: historicalDetails.size, expected: 22 });
const reuseKeys = new Set((plan.reusedPublicParameters ?? []).map(item => normalizedKey(item.skillKey, 'parameters', item.parameterKey)));
staticCheck('复用公共参数22项且无重复', reuseKeys.size === expected.reusedPublicParameters && (plan.reusedPublicParameters ?? []).length === expected.reusedPublicParameters, { count: reuseKeys.size });
const expectedEntries = [];
for (const skillKey of skills) {
  for (const [kind, key] of kinds) {
    const bodies = candidate.skills[skillKey].write[kind] ?? [];
    for (const body of bodies) {
      const id = body[key];
      expectedEntries.push({ skillKey, kind, id, base: `/skills/${skillKey}/${apiKind(kind)}`, route: `/skills/${skillKey}/${apiKind(kind)}/${encodeURIComponent(id)}`, body });
    }
  }
}
const expectedEntryKeys = new Set(expectedEntries.map(entry => normalizedKey(entry.skillKey, entry.kind, entry.id)));
staticCheck('候选组成键唯一', expectedEntryKeys.size === expectedEntries.length, { total: expectedEntries.length, unique: expectedEntryKeys.size });
const newEntries = expectedEntries.filter(entry => !historicalDetails.has(normalizedKey(entry.skillKey, entry.kind, entry.id)));
staticCheck('候选新增131项', newEntries.length === expected.newComponents, { actual: newEntries.length, expected: expected.newComponents });
const planKeys = new Set((plan.requests ?? []).map(item => normalizedKey(item.skillKey, item.kind, item.stableKey ?? item.key)));
staticCheck('写前计划键唯一且覆盖候选新增', planKeys.size === plan.requests?.length && planKeys.size === newEntries.length && newEntries.every(entry => planKeys.has(normalizedKey(entry.skillKey, entry.kind, entry.id))), { planKeys: planKeys.size, newEntries: newEntries.length });
for (const entry of newEntries) {
  const planned = (plan.requests ?? []).find(item => normalizedKey(item.skillKey, item.kind, item.stableKey ?? item.key) === normalizedKey(entry.skillKey, entry.kind, entry.id));
  staticCheck(`计划对象等于候选 ${normalizedKey(entry.skillKey, entry.kind, entry.id)}`, Boolean(planned) && planned.route === entry.base && equal(planned.body, entry.body), planned ? { route: planned.route, expected: entry.base } : null);
}
for (const reuse of plan.reusedPublicParameters ?? []) {
  const identity = normalizedKey(reuse.skillKey, 'parameters', reuse.parameterKey);
  const old = historicalDetails.get(identity);
  const body = candidate.skills[reuse.skillKey]?.write?.parameters?.find(item => item.parameterKey === reuse.parameterKey);
  staticCheck(`公共参数复用值一致 ${identity}`, Boolean(old && body) && !parameterValueDiff(body, old), parameterValueDiff(body, old));
}

function validateSchema() {
  const errors = [];
  const add = (message, detail) => errors.push({ message, detail });
  const walk = (value, at) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${at}[${index}]`));
    if (value.nodeType !== undefined) {
      if (!schema.nodeTypes.has(value.nodeType)) add(`未知公式节点类型 ${value.nodeType}`, at);
      if (value.nodeType === 'OPERATION' && !schema.operations.has(value.operation)) add(`未知公式运算 ${value.operation}`, at);
    }
    if (value.resultType !== undefined && !schema.resultTypes.has(value.resultType)) add(`未知效果结果类型 ${value.resultType}`, at);
    if (value.operation !== undefined && value.detail?.attributeKey && !schema.resourceOperations.has(value.operation)) add(`未知资源操作 ${value.operation}`, at);
    for (const [key, child] of Object.entries(value)) walk(child, `${at}.${key}`);
  };
  for (const skillKey of skills) {
    const skill = candidate.skills[skillKey];
    for (const parameter of skill.write.parameters) {
      if (!schema.parameterValueTypes.has(parameter.valueType)) add(`未知参数值类型 ${parameter.valueType}`, `${skillKey}/${parameter.parameterKey}`);
      if (!schema.parameterValueModes.has(parameter.valueMode)) add(`未知参数值模式 ${parameter.valueMode}`, `${skillKey}/${parameter.parameterKey}`);
      if (parameter.valueMode === 'FIXED' && (parameter.fixedValue === null || parameter.fixedValue === undefined || parameter.levelValues !== null)) add('固定参数形态不完整', `${skillKey}/${parameter.parameterKey}`);
      if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null || parameter.levelValues !== null)) add('运行输入不能有默认值', `${skillKey}/${parameter.parameterKey}`);
      if (parameter.valueMode === 'SKILL_LEVEL' && (parameter.fixedValue !== null || !parameter.levelValues || Object.keys(parameter.levelValues).length !== skill.maxLevel)) add('技能等级参数等级表不完整', `${skillKey}/${parameter.parameterKey}`);
      const values = parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues ?? {}) : parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : [];
      if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) add('参数值不是有限数字', `${skillKey}/${parameter.parameterKey}`);
      if (parameter.valueType === 'INTEGER' && values.some(value => !Number.isInteger(value))) add('整数参数含小数值', `${skillKey}/${parameter.parameterKey}`);
    }
    walk(skill.write.formulas, `${skillKey}/formulas`);
    walk(skill.write.effects, `${skillKey}/effects`);
    for (const kind of ['processes', 'internalStates', 'triggerRules']) if (skill.write[kind].length) add(`本批禁止写入${kind}`, `${skillKey}/${kind}`);
  }
  return errors;
}
const schemaErrors = validateSchema();
staticCheck('实际类型和结构字典无未知值', schemaErrors.length === 0, schemaErrors);
const forbiddenWriteText = JSON.stringify(Object.fromEntries(skills.map(skillKey => [skillKey, candidate.skills[skillKey].write])));
for (const forbidden of ['MOMENT_EVALUATION', 'RUNTIME_INPUT_FORBIDDEN', 'actual_missing_health', 'damage_tick_interval_ms', 'single_target_eligibility_lower_bound']) staticCheck(`写入树不含${forbidden}`, !forbiddenWriteText.includes(forbidden), null);
staticCheck('写入树没有即时伤害或直接治疗', !forbiddenWriteText.includes('"resultType":"DAMAGE"') && !forbiddenWriteText.includes('"resultType":"DIRECT_HEAL"'), null);

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(herePath, '执行记录', runId);
await fsp.mkdir(runDir, { recursive: true });
const httpJournal = path.join(runDir, 'HTTP流水.jsonl');
const writeJournal = path.join(runDir, '写入流水.jsonl');
const runLock = path.join(runDir, '运行锁.json');
const writeLock = path.join(herePath, '执行准备', '实际录入写入锁.json');
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
    if (sha256(readBytes(filePath(candidateFile))) !== expected.candidateSha256 || sha256(readBytes(filePath(planFile))) !== expected.writePlanSha256 || sha256(readBytes(filePath(freezeFile))) !== expected.freezeSha256) throw Error('POST前冻结文件散列变化');
    const match = route.match(/^\/skills\/([^/]+)\/(parameters|formulas|effects)$/);
    if (!match || !skills.includes(match[1])) throw Error(`POST超出本批范围 ${route}`);
    const kind = kinds.find(item => item[2] === match[2]);
    const id = body?.[kind[1]];
    const allowed = candidate.skills[match[1]].write[kind[0]].find(item => item[kind[1]] === id);
    if (!allowed || !equal(allowed, body)) throw Error(`POST对象不等于冻结候选 ${route}/${id}`);
    const planned = (plan.requests ?? []).some(item => item.route === route && (item.stableKey ?? item.key) === id && equal(item.body, body));
    if (!planned) throw Error(`POST不在冻结131项计划内 ${route}/${id}`);
  }
  const sequence = calls.length + 1;
  const startedAt = new Date().toISOString();
  await appendJsonl(httpJournal, { sequence, phase: '请求前', at: startedAt, method, route, ...(body ? { body } : {}) });
  let result;
  const started = Date.now();
  try {
    const response = await fetch(apiBase + route, { method, headers: { Authorization: `Bearer ${process.env.HERO16_API_TOKEN ?? 'local-entry'}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
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
    result.characters[hero] = await mustGet(`/characters/champion_${hero}`);
    result.relations[hero] = await mustGet(`/character-skill-relations?characterKey=champion_${hero}`);
  }
  for (const skillKey of skills) {
    result.subjects[skillKey] = await mustGet(`/skills/${skillKey}`);
    result.images[skillKey] = await mustGet(`/skills/${skillKey}/representative-image`);
  }
  return result;
};
const historicalMediaData = new Map((media.requests ?? []).map(item => [item.route, item.data]));
const validateProtection = protection => {
  const conflicts = [];
  for (const [name, key] of catalogKinds) {
    const expectedRows = rows(original.catalogs?.[name]);
    const actualRows = rows(protection.catalogs[name]);
    if (exactDiff(expectedRows, actualRows)) conflicts.push({ type: 'catalog', name, diff: exactDiff(expectedRows, actualRows) });
  }
  for (const skillKey of skills) {
    const expectedSubject = original.skills?.[skillKey]?.subject?.data;
    const actualSubject = protection.subjects[skillKey]?.data;
    const subjectDiff = exactDiff(expectedSubject, actualSubject);
    if (subjectDiff) conflicts.push({ type: 'subject', skillKey, diff: subjectDiff });
    if (actualSubject?.maxLevel !== candidate.skills[skillKey].maxLevel) conflicts.push({ type: 'subjectMaxLevel', skillKey, expected: candidate.skills[skillKey].maxLevel, actual: actualSubject?.maxLevel });
  }
  for (const hero of heroes) {
    const characterRoute = `/characters/champion_${hero}`;
    const relationRoute = `/character-skill-relations?characterKey=champion_${hero}`;
    const characterDiff = exactDiff(historicalMediaData.get(characterRoute), protection.characters[hero]?.data);
    const relationDiff = exactDiff(historicalMediaData.get(relationRoute), protection.relations[hero]?.data);
    if (characterDiff) conflicts.push({ type: 'character', hero, diff: characterDiff });
    if (relationDiff) conflicts.push({ type: 'relation', hero, diff: relationDiff });
  }
  for (const skillKey of skills) {
    const imageRoute = `/skills/${skillKey}/representative-image`;
    const imageDiff = exactDiff(historicalMediaData.get(imageRoute), protection.images[skillKey]?.data);
    if (imageDiff) conflicts.push({ type: 'image', skillKey, diff: imageDiff });
  }
  return conflicts;
};
const validateCatalogReferences = protection => {
  const sets = Object.fromEntries(catalogKinds.map(([name, key]) => [key, new Map(rows(protection.catalogs[name]).map(item => [item[key], item]))]));
  const references = [];
  const conflicts = [];
  const walk = (value, at) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${at}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (sets[key] && typeof child === 'string') {
        const item = sets[key].get(child);
        const enabled = item?.status === 'ENABLED';
        references.push({ at: `${at}.${key}`, key, value: child, enabled });
        if (!enabled) conflicts.push({ at: `${at}.${key}`, key, value: child, reason: item ? `状态为${item.status}` : '目录不存在' });
      }
      walk(child, `${at}.${key}`);
    }
  };
  for (const entry of expectedEntries) walk(entry.body, `${entry.skillKey}/${entry.kind}/${entry.id}`);
  return { references, conflicts, sets };
};
const listItemsFromHistorical = (skillKey, kind) => historicalLists.get(`${skillKey}/${kind}`) ?? [];
const fetchComponentState = async (protection, phase) => {
  const lists = [];
  const details = [];
  const conflicts = [];
  const missing = [];
  const existing = [];
  for (const skillKey of skills) {
    for (const [kind, key, endpointKind] of kinds) {
      const route = `/skills/${skillKey}/${endpointKind}`;
      const response = await mustGet(route);
      const items = rows(response);
      const ids = items.map(item => item[key]);
      if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) conflicts.push({ phase, type: 'duplicateOrInvalidKey', skillKey, kind, ids });
      if (phase === '写前') {
        const listDiff = exactDiff(listItemsFromHistorical(skillKey, kind), items);
        if (listDiff) conflicts.push({ phase, type: 'historicalListChanged', skillKey, kind, diff: listDiff });
      }
      const listRecord = { skillKey, kind, route, status: response.status, items };
      lists.push(listRecord);
      for (const item of items) {
        const id = item[key];
        const detailRoute = `${route}/${encodeURIComponent(id)}`;
        const detailResponse = await mustGet(detailRoute);
        const detail = detailResponse.data;
        const listDiff = listSummaryDiff(item, detail);
        if (listDiff) conflicts.push({ phase, type: 'listDetailMismatch', skillKey, kind, id, diff: listDiff });
        const record = { skillKey, kind, id, route: detailRoute, status: detailResponse.status, data: detail, listItem: item, listSummaryDiff: listDiff };
        details.push(record);
        const identity = normalizedKey(skillKey, kind, id);
        const candidateBody = candidate.skills[skillKey].write[kind].find(body => body[key] === id);
        const oldBody = historicalDetails.get(identity);
        if (!candidateBody) conflicts.push({ phase, type: 'unexpectedExisting', skillKey, kind, id });
        if (oldBody) {
          const oldDiff = exactDiff(oldBody, detail);
          if (oldDiff) conflicts.push({ phase, type: 'protectedOriginalChanged', skillKey, kind, id, diff: oldDiff });
          if (candidateBody) {
            const valueDiff = kind === 'parameters' ? parameterValueDiff(candidateBody, detail) : businessDiff(candidateBody, detail);
            if (valueDiff) conflicts.push({ phase, type: 'existingValueMismatch', skillKey, kind, id, diff: valueDiff });
          }
          existing.push({ skillKey, kind, id, classification: '保护并复用', oldProtected: true });
        } else if (candidateBody) {
          const candidateDiff = businessDiff(candidateBody, detail);
          if (candidateDiff) conflicts.push({ phase, type: 'existingCandidateMismatch', skillKey, kind, id, diff: candidateDiff });
          existing.push({ skillKey, kind, id, classification: candidateDiff ? '现值异值' : '已有同值', oldProtected: false });
        }
      }
      const currentIds = new Set(items.map(item => item[key]));
      for (const entry of candidate.skills[skillKey].write[kind]) {
        if (!currentIds.has(entry[key])) missing.push({ skillKey, kind, id: entry[key], idField: key, base: route, route: `${route}/${encodeURIComponent(entry[key])}`, body: entry });
      }
    }
  }
  return { phase, startedAt: new Date().toISOString(), subjects: protection.subjects, lists, details, missing, existing, conflicts, counts: { lists: lists.length, details: details.length, existing: existing.length, missing: missing.length }, finishedAt: new Date().toISOString() };
};
const validatePreflightState = (protection, componentState, catalogResult) => {
  const conflicts = [...componentState.conflicts, ...catalogResult.conflicts, ...validateProtection(protection)];
  const expectedReuse = [...reuseKeys];
  const actualReuse = componentState.existing.filter(item => item.oldProtected).map(item => normalizedKey(item.skillKey, item.kind, item.id));
  for (const key of expectedReuse) if (!actualReuse.includes(key)) conflicts.push({ type: 'reuseMissing', key });
  for (const key of actualReuse) if (!expectedReuse.includes(key)) conflicts.push({ type: 'reuseUnexpected', key });
  if (componentState.details.length !== 22) conflicts.push({ type: 'protectedDetailCount', actual: componentState.details.length, expected: 22 });
  if (componentState.missing.length > expected.newComponents) conflicts.push({ type: 'missingCountTooLarge', actual: componentState.missing.length, expected: expected.newComponents });
  if (componentState.existing.length + componentState.missing.length !== totalCandidateComponents) conflicts.push({ type: 'candidateTotalMismatch', existing: componentState.existing.length, missing: componentState.missing.length, expected: totalCandidateComponents });
  return conflicts;
};
const acquireWriteLock = async () => {
  await fsp.mkdir(path.dirname(writeLock), { recursive: true });
  let handle;
  try { handle = await fsp.open(writeLock, 'wx'); } catch (error) {
    if (error.code === 'EEXIST') throw Error('已有第十六批实际写入锁，禁止并行或重放');
    throw error;
  }
  try { await handle.writeFile(JSON.stringify({ at: new Date().toISOString(), runId, candidateSha256: expected.candidateSha256, planSha256: expected.writePlanSha256, expectedPostCount: expected.newComponents, policy: '只允许冻结计划中的参数、公式、效果POST；其他对象永不POST。' }, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
};
const createIntent = async entry => {
  const intentDir = path.join(herePath, '写前意图');
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
  candidateVersionSha256: expected.candidateVersionSha256,
  candidatePlanSha256: expected.candidatePlanSha256,
  writePlanSha256: expected.writePlanSha256,
  freezeSha256: expected.freezeSha256,
  expected: { catalogs: 4, subjects: 20, characters: 4, relations: 4, images: 20, lists: 120, protectedDetails: 22, candidateDetails: 153, newComponents: 131 },
  candidateCounts,
  reusedPublicParameters: expected.reusedPublicParameters,
  apiWrites: 0,
  calls: null,
  staticChecks,
  staticFailures,
  success: false,
  errors: [],
};
const saveReport = async () => {
  report.calls = { total: calls.length, methods: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}), statuses: calls.reduce((out, item) => { out[String(item.status)] = (out[String(item.status)] ?? 0) + 1; return out; }, {}) };
  report.apiWrites = calls.filter(item => item.method === 'POST').length;
  report.writeEvents = writeEvents.length;
  await saveJson('执行结果.json', report);
};

await fsp.writeFile(runLock, JSON.stringify({ at: new Date().toISOString(), runId, mode: apply ? 'apply' : 'preflight', candidateSha256: expected.candidateSha256, planSha256: expected.writePlanSha256, expectedApiWrites: apply ? expected.newComponents : 0 }, null, 2) + '\n');
await appendJsonl(httpJournal, { sequence: 0, phase: '运行开始', at: new Date().toISOString(), method: 'NONE', route: null, mode: apply ? 'apply' : 'preflight' });

let preflightProtection = null;
let preflightCatalog = null;
let preflightComponents = null;
try {
  if (staticFailures.length) throw Error(`静态冻结校验失败 ${staticFailures.length} 项`);
  preflightProtection = await fetchProtection();
  preflightCatalog = validateCatalogReferences(preflightProtection);
  const protectionConflicts = validateProtection(preflightProtection);
  await saveJson('写前保护.json', preflightProtection);
  preflightComponents = await fetchComponentState(preflightProtection, '写前');
  const allConflicts = validatePreflightState(preflightProtection, preflightComponents, preflightCatalog);
  preflightComponents.protectionConflicts = protectionConflicts;
  preflightComponents.catalogReferences = preflightCatalog.references;
  preflightComponents.catalogConflicts = preflightCatalog.conflicts;
  preflightComponents.allConflicts = allConflicts;
  await saveJson('写前组件现值.json', preflightComponents);
  report.preflight = { pass: allConflicts.length === 0, protectionConflicts: protectionConflicts.length, catalogReferences: preflightCatalog.references.length, catalogConflicts: preflightCatalog.conflicts.length, conflicts: allConflicts.length, counts: preflightComponents.counts, missingByKind: Object.fromEntries(kinds.map(([kind]) => [kind, preflightComponents.missing.filter(item => item.kind === kind).length])) };
  await saveReport();
  if (allConflicts.length) throw Error(`写前保护、目录或组成冲突 ${allConflicts.length} 项`);
  if (!apply) {
    report.success = true;
    report.independentReadback = '另行运行独立全量回读.mjs；该脚本重新GET153条详情，不读取本次写入器快照作数学依据。';
  } else if (preflightComponents.missing.length === 0) {
    report.success = true;
    report.apply = { confirmed: 0, postCount: 0, skipped: '所有候选已同值存在，未重放POST' };
  } else {
    await acquireWriteLock();
    await appendJsonl(writeJournal, { at: new Date().toISOString(), phase: '写入锁已取得', runId, expectedPostCount: preflightComponents.missing.length });
    const applyResult = { startedAt: new Date().toISOString(), confirmed: 0, postCount: 0, stopped: false, stopReason: null, events: [] };
    for (const entry of preflightComponents.missing) {
      const before = await optionalMissingGet(entry.route);
      if (before.status === 200) {
        const existingDiff = businessDiff(entry.body, before.data);
        if (existingDiff) throw Error(`写前缺项已异值 ${entry.skillKey}/${entry.kind}/${entry.id}`);
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
      const afterDiff = businessDiff(entry.body, after.data);
      const matched = !afterDiff;
      await emitWrite({ skillKey: entry.skillKey, kind: entry.kind, id: entry.id, action: post.ok && matched ? '创建后独立回读确认' : '响应或回读异常，停止全部写入', postStatus: post.status, postOk: post.ok, readbackStatus: after.status, matched, diff: afterDiff, actual: after.data });
      applyResult.postCount++;
      if (!post.ok || !matched) {
        applyResult.stopped = true;
        applyResult.stopReason = { phase: '写后完整GET对账', skillKey: entry.skillKey, kind: entry.kind, id: entry.id, postStatus: post.status, readbackStatus: after.status, diff: afterDiff };
        break;
      }
      applyResult.confirmed++;
    }
    applyResult.finishedAt = new Date().toISOString();
    report.apply = applyResult;
    await saveJson('实际写入结果.json', applyResult);
    await saveReport();
    if (applyResult.stopped || applyResult.confirmed !== preflightComponents.missing.length) throw Error('实际补缺没有全部独立回读确认');
    const postProtection = await fetchProtection();
    const postProtectionConflicts = validateProtectionAgainst(preflightProtection, postProtection);
    await saveJson('写后保护.json', postProtection);
    const finalComponents = await fetchComponentState(postProtection, '写后');
    await saveJson('最终全量组件现值.json', finalComponents);
    report.final = { details: finalComponents.details.length, lists: finalComponents.lists.length, missing: finalComponents.missing.length, conflicts: finalComponents.conflicts.length, protectionDrift: postProtectionConflicts.length, pass: finalComponents.details.length === totalCandidateComponents && finalComponents.missing.length === 0 && finalComponents.conflicts.length === 0 && postProtectionConflicts.length === 0 };
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

// 与初始保护快照逐字段比较；服务端字段也保留在快照中，比较时不截断任何正文。
function validateProtectionAgainst(before, after) {
  const conflicts = [];
  for (const [name, key] of catalogKinds) {
    const diffValue = exactDiff(rows(before.catalogs[name]), rows(after.catalogs[name]));
    if (diffValue) conflicts.push({ type: 'catalog', name, diff: diffValue });
  }
  for (const skillKey of skills) {
    const subjectDiff = exactDiff(before.subjects[skillKey]?.data, after.subjects[skillKey]?.data);
    const imageDiff = exactDiff(before.images[skillKey]?.data, after.images[skillKey]?.data);
    if (subjectDiff) conflicts.push({ type: 'subject', skillKey, diff: subjectDiff });
    if (imageDiff) conflicts.push({ type: 'image', skillKey, diff: imageDiff });
  }
  for (const hero of heroes) {
    const characterDiff = exactDiff(before.characters[hero]?.data, after.characters[hero]?.data);
    const relationDiff = exactDiff(before.relations[hero]?.data, after.relations[hero]?.data);
    if (characterDiff) conflicts.push({ type: 'character', hero, diff: characterDiff });
    if (relationDiff) conflicts.push({ type: 'relation', hero, diff: relationDiff });
  }
  return conflicts;
}

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

// 默认只读预检。只有 --apply、专用环境确认、唯一写入锁和逐项保护都通过时才允许POST。
// 只向参数、公式、效果的修订一计划发POST；技能主体、角色、关系、图片、六类列表和已有详情永不写入。
const here = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidateName = '修订一-完整候选.json';
const planName = '修订一-写前请求意图.json';
const snapshotName = '实际现值保护快照.json';
const sourceName = '来源哈希汇总.json';
const oldCandidateName = '完整候选.json';
const oldPlanName = '写前请求意图.json';
const oldMathName = '独立数学核算.json';
const revisionMathName = '修订一-独立数学核算.json';
const heroes = ['nasus', 'chogath', 'galio', 'rammus'];
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
  ['skill-categories', 'skillCategoryKey'],
  ['attributes', 'attributeKey'],
  ['modifier-zones', 'modifierZoneKey'],
  ['damage-types', 'damageTypeKey'],
];
const expected = {
  candidateSha256: '7fddee3b4b2fd121d3c053ba20388a69e38e2069a42ad7b80a054c56b70ce5c9',
  planSha256: 'b542da6edbc8fedba977ea20bb61e78ab436ae9a9fd7f290f6419b8bb19e855a',
  oldCandidateSha256: '723d467d65d4942ec64261530b863f3cd0d06e101fcc3b38731feeb3af1f93d2',
  oldPlanSha256: '9a220bc33362948aa170c518e551a64cf34dcfe1def8b291b19bdd3410586d9a',
  snapshotSha256: 'c422962b4c93fb0d642fe294b2dc1b7044566985039a141f8291a1151f74387f',
  sourceSha256: '57a9546ba221db52063ba438aa9454e251c296f64e621918b54524505f0e97d0',
  oldMathSha256: 'ce8bc87a5bc17026c805f3f1f35296d054b980799d9aec12762dfedd2ffae686',
  revisionMathSha256: '910d4db5adbeca11b85c19e894766df1be3c9e0e24586876347855520ad0a638',
  requestCount: 158,
  candidateCounts: { parameters: 122, formulas: 24, effects: 12, processes: 0, internalStates: 0, triggerRules: 0 },
  baselineDetails: 69,
  lists: 120,
};
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw new Error('只接受默认只读预检或 --apply');
const apply = args.includes('--apply');
if (apply && process.env.HERO20_APPLY_CONFIRM !== 'CONFIRM_HERO20_REVISION_ONE_POSTS') throw new Error('实际POST需要显式设置 HERO20_APPLY_CONFIRM=CONFIRM_HERO20_REVISION_ONE_POSTS');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const readBytes = name => fs.readFileSync(path.join(here, name));
const readJson = name => JSON.parse(readBytes(name));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const rows = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.data) ? value.data : Array.isArray(value?.data?.items) ? value.data.items : [];
const idField = kind => kinds.find(item => item[0] === kind)?.[1];
const endpointKind = kind => kinds.find(item => item[0] === kind)?.[2];
const keyOf = (skillKey, kind, id) => `${skillKey}/${kind}/${id}`;
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
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
  if (!item || !detail) return { path: '$', expected: '详情对象', actual: detail };
  const countFields = {
    actionCount: 'actions',
    conditionGroupCount: 'conditionGroups',
    effectBindingCount: 'effectBindings',
    resultCount: 'results',
    stateOperationCount: 'stateOperations',
    stepCount: 'steps',
  };
  for (const [key, expectedValue] of Object.entries(item)) {
    // 触发规则详情接口不返回列表摘要中的更新时间；列表行和详情仍分别做冻结全字段保护。
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

const candidateBytes = readBytes(candidateName);
const planBytes = readBytes(planName);
const snapshotBytes = readBytes(snapshotName);
const sourceBytes = readBytes(sourceName);
const oldCandidateBytes = readBytes(oldCandidateName);
const oldPlanBytes = readBytes(oldPlanName);
const oldMathBytes = readBytes(oldMathName);
const revisionMathBytes = readBytes(revisionMathName);
const candidate = JSON.parse(candidateBytes);
const plan = JSON.parse(planBytes);
const baseline = JSON.parse(snapshotBytes);
const staticChecks = [];
const staticFailures = [];
const check = (name, passed, detail = null) => {
  const row = { name, passed: Boolean(passed), detail };
  staticChecks.push(row);
  if (!row.passed) staticFailures.push(row);
  return row.passed;
};
const hashCheck = (name, bytes, expectedHash) => check(name, sha256(bytes) === expectedHash, sha256(bytes));
hashCheck('修订候选哈希', candidateBytes, expected.candidateSha256);
hashCheck('修订请求计划哈希', planBytes, expected.planSha256);
hashCheck('旧候选保持原字节', oldCandidateBytes, expected.oldCandidateSha256);
hashCheck('旧请求保持原字节', oldPlanBytes, expected.oldPlanSha256);
hashCheck('现值快照保持原字节', snapshotBytes, expected.snapshotSha256);
hashCheck('来源清单保持原字节', sourceBytes, expected.sourceSha256);
hashCheck('旧数学结果保持原字节', oldMathBytes, expected.oldMathSha256);
hashCheck('修订数学结果已核对', revisionMathBytes, expected.revisionMathSha256);

const candidateEntries = [];
const candidateByKey = new Map();
const planByKey = new Map();
for (const skillKey of skills) {
  const skill = candidate.skills?.[skillKey];
  if (!skill) { check(`候选包含${skillKey}`, false, '缺少技能槽'); continue; }
  for (const [kind, key] of kinds) {
    const list = skill.write?.[kind];
    check(`${skillKey}/${kind}为数组`, Array.isArray(list), Array.isArray(list) ? list.length : typeof list);
    for (const body of list ?? []) {
      const id = body?.[key];
      const entry = { skillKey, kind, id, key, body, baseRoute: `/skills/${encodeURIComponent(skillKey)}/${endpointKind(kind)}`, detailRoute: `/skills/${encodeURIComponent(skillKey)}/${endpointKind(kind)}/${encodeURIComponent(id ?? '')}` };
      const compound = keyOf(skillKey, kind, id);
      candidateEntries.push(entry);
      if (candidateByKey.has(compound)) check(`候选无重复${compound}`, false, '重复组成键');
      candidateByKey.set(compound, entry);
    }
  }
}
const candidateCounts = Object.fromEntries(kinds.map(([kind]) => [kind, candidateEntries.filter(entry => entry.kind === kind).length]));
check('候选技能位恰为20项', equal(Object.keys(candidate.skills ?? {}), skills), Object.keys(candidate.skills ?? {}));
check('候选组成恰为158项', candidateEntries.length === expected.requestCount, candidateEntries.length);
check('候选计数与修订计数一致', equal(candidateCounts, candidate.counts), { candidateCounts, declared: candidate.counts });
check('候选计数符合修订预期', equal(candidateCounts, expected.candidateCounts), candidateCounts);
check('候选元数据没有业务写入', candidate.meta?.businessWrites === 0 && candidate.meta?.apiCalls === 0, { businessWrites: candidate.meta?.businessWrites, apiCalls: candidate.meta?.apiCalls });
check('请求计划恰为158条POST意图', plan.requestCount === expected.requestCount && plan.requests?.length === expected.requestCount && plan.requests.every(item => item.method === 'POST'), { requestCount: plan.requestCount, actual: plan.requests?.length });
check('请求计划绑定修订候选', plan.candidateSha256 === expected.candidateSha256, plan.candidateSha256);
for (const request of plan.requests ?? []) {
  const compound = keyOf(request.skillKey, request.kind, request.stableKey);
  if (planByKey.has(compound)) check(`请求无重复${compound}`, false, '重复请求键');
  planByKey.set(compound, request);
  const entry = candidateByKey.get(compound);
  check(`请求属于候选${compound}`, Boolean(entry) && request.route === entry.baseRoute && equal(request.body, entry.body), { route: request.route, expected: entry?.baseRoute });
}
check('候选与请求组成逐项一致', candidateEntries.every(entry => planByKey.has(keyOf(entry.skillKey, entry.kind, entry.id)) && equal(planByKey.get(keyOf(entry.skillKey, entry.kind, entry.id)).body, entry.body)), { candidate: candidateEntries.length, plan: planByKey.size });
for (const skillKey of skills) {
  if (skillKey.startsWith('nasus_')) check(`Nasus整槽无新增组成${skillKey}`, (candidate.skills[skillKey]?.write?.parameters?.length ?? 0) + (candidate.skills[skillKey]?.write?.formulas?.length ?? 0) + (candidate.skills[skillKey]?.write?.effects?.length ?? 0) === 0, candidate.skills[skillKey]?.write);
}
const baselineComponentByKey = new Map();
for (const skillKey of skills) {
  const component = baseline.components?.[skillKey];
  for (const [kind, key] of kinds) {
    const list = component?.[kind]?.list ?? [];
    const details = component?.[kind]?.details ?? [];
    for (const row of list) {
      const id = row[key];
      const detail = details.find(item => item.stableKey === id)?.response;
      if (!detail) check(`冻结详情存在${keyOf(skillKey, kind, id)}`, false, '快照缺少详情');
      baselineComponentByKey.set(keyOf(skillKey, kind, id), { list: row, detail });
    }
  }
}
check('冻结已有组成详情恰为69项', baselineComponentByKey.size === expected.baselineDetails, baselineComponentByKey.size);
for (const key of baselineComponentByKey.keys()) check(`候选不覆盖冻结组成${key}`, !candidateByKey.has(key), candidateByKey.has(key));
for (const [skillKey, kind, id] of candidateEntries.map(entry => [entry.skillKey, entry.kind, entry.id])) {
  check(`候选不覆盖已有组成${keyOf(skillKey, kind, id)}`, !baselineComponentByKey.has(keyOf(skillKey, kind, id)), baselineComponentByKey.has(keyOf(skillKey, kind, id)));
}
for (const [skillKey, skill] of Object.entries(candidate.skills ?? {})) {
  for (const kind of ['processes', 'internalStates', 'triggerRules']) check(`${skillKey}/${kind}不创建`, (skill.write?.[kind]?.length ?? 0) === 0, skill.write?.[kind]);
  for (const effect of skill.write?.effects ?? []) for (const result of effect.results ?? []) check(`${skillKey}/${effect.effectKey}仅资源变化`, result.resultType === 'RESOURCE_CHANGE', result.resultType);
}
const allowedNodeTypes = new Set(['PARAMETER', 'ATTRIBUTE', 'OPERATION']);
const allowedOperations = new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']);
function checkExpression(skillKey, formulaKey, node, at = '$') {
  if (!node || typeof node !== 'object') { check(`公式节点${skillKey}/${formulaKey}${at}`, false, node); return; }
  check(`公式节点类型${skillKey}/${formulaKey}${at}`, allowedNodeTypes.has(node.nodeType), node.nodeType);
  if (node.nodeType === 'ATTRIBUTE') {
    check(`公式属性归属${skillKey}/${formulaKey}${at}`, ['SOURCE', 'TARGET'].includes(node.attributeOwner), node);
    check(`公式属性值类${skillKey}/${formulaKey}${at}`, ['TOTAL', 'BASE', 'BONUS'].includes(node.attributeValueKind), node);
  }
  if (node.nodeType === 'OPERATION') {
    check(`公式运算${skillKey}/${formulaKey}${at}`, allowedOperations.has(node.operation) && Array.isArray(node.operands) && node.operands.length === 2, node);
    for (const [index, child] of (node.operands ?? []).entries()) checkExpression(skillKey, formulaKey, child, `${at}.operands[${index}]`);
  }
}
for (const skillKey of skills) for (const formula of candidate.skills[skillKey]?.write?.formulas ?? []) checkExpression(skillKey, formula.formulaKey, formula.expression);

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(here, '修订一-写入准备', runId);
const httpJournal = path.join(runDir, 'HTTP流水.jsonl');
const calls = [];
const writeEvents = [];
const errors = [];
await fsp.mkdir(runDir, { recursive: true });
await fsp.writeFile(path.join(runDir, '运行锁.json'), JSON.stringify({ at: new Date().toISOString(), runId, mode: apply ? '受保护实际写入' : '只读预检', candidateSha256: expected.candidateSha256, planSha256: expected.planSha256, expectedRequests: apply ? expected.requestCount : 0, apiWrites: 0, status: 'RUNNING' }, null, 2) + '\n');
const appendJsonl = async (file, value) => {
  const handle = await fsp.open(file, 'a');
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
};
const saveJson = async (name, value) => { await fsp.writeFile(path.join(runDir, name), jsonBytes(value)); };
const appendEvent = async event => { const row = { at: new Date().toISOString(), ...event }; writeEvents.push(row); await appendJsonl(path.join(runDir, '逐项写入日志.jsonl'), row); };
const safeRoute = route => {
  if (typeof route !== 'string' || !route.startsWith('/') || route.includes('://') || route.includes('..')) throw new Error(`非法API路径：${route}`);
  return route;
};
const request = async (method, route, body) => {
  safeRoute(route);
  const sequence = calls.length + 1;
  const startedAt = new Date().toISOString();
  await appendJsonl(httpJournal, { sequence, phase: '请求前', at: startedAt, method, route, ...(body === undefined ? {} : { body }) });
  const started = Date.now();
  let result;
  try {
    const response = await fetch(apiBase + route, {
      method,
      headers: { Authorization: `Bearer ${process.env.HERO20_API_TOKEN ?? 'local-entry'}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    const raw = await response.text();
    let data = null;
    let parseError = false;
    try { data = raw ? JSON.parse(raw) : null; } catch { parseError = true; }
    result = { sequence, method, route, status: response.status, ok: response.ok && !parseError, data, ...(parseError ? { parseError: true, responseBytes: Buffer.byteLength(raw), responseSha256: sha256(raw) } : {}) };
  } catch (error) {
    result = { sequence, method, route, status: null, ok: false, data: null, error: `${error.name}: ${error.message}` };
  }
  calls.push(result);
  await appendJsonl(httpJournal, { ...result, phase: '请求后', at: new Date().toISOString(), elapsedMs: Date.now() - started });
  return result;
};
const get = async route => request('GET', route);
const mustGet = async route => {
  const result = await get(route);
  if (!result.ok) throw new Error(`GET失败：${route} status=${result.status ?? 'network'}${result.error ? ` ${result.error}` : ''}`);
  return result;
};
const optionalDetailGet = async route => {
  const result = await get(route);
  if (result.status !== 404 && !result.ok) throw new Error(`缺项GET异常：${route} status=${result.status ?? 'network'}${result.error ? ` ${result.error}` : ''}`);
  return result;
};

const fetchProtection = async () => {
  const protection = { catalogs: {}, characters: {}, relations: {}, subjects: {}, images: {} };
  for (const [name] of catalogKinds) protection.catalogs[name] = (await mustGet(`/${name}`)).data;
  for (const hero of heroes) {
    const characterKey = `champion_${hero}`;
    protection.characters[hero] = (await mustGet(`/characters/${encodeURIComponent(characterKey)}`)).data;
    protection.relations[hero] = (await mustGet(`/character-skill-relations?characterKey=${encodeURIComponent(characterKey)}`)).data;
  }
  for (const skillKey of skills) {
    protection.subjects[skillKey] = (await mustGet(`/skills/${encodeURIComponent(skillKey)}`)).data;
    protection.images[skillKey] = (await mustGet(`/skills/${encodeURIComponent(skillKey)}/representative-image`)).data;
  }
  return protection;
};
const protectionDiffs = (before, after) => {
  const conflicts = [];
  for (const [name] of catalogKinds) {
    const difference = exactDiff(baseline.catalogs?.[name], after.catalogs?.[name]);
    if (difference) conflicts.push({ type: 'catalog', name, diff: difference });
  }
  for (const hero of heroes) {
    const characterDifference = exactDiff(baseline.characters?.[hero], after.characters?.[hero]);
    const relationDifference = exactDiff(baseline.relations?.[hero], after.relations?.[hero]);
    if (characterDifference) conflicts.push({ type: 'character', hero, diff: characterDifference });
    if (relationDifference) conflicts.push({ type: 'relation', hero, diff: relationDifference });
  }
  for (const skillKey of skills) {
    const subjectDifference = exactDiff(baseline.subjects?.[skillKey], after.subjects?.[skillKey]);
    const imageDifference = exactDiff(baseline.images?.[skillKey], after.images?.[skillKey]);
    if (subjectDifference) conflicts.push({ type: 'subject', skillKey, diff: subjectDifference });
    if (imageDifference) conflicts.push({ type: 'image', skillKey, diff: imageDifference });
  }
  return conflicts;
};
const catalogReferenceCheck = protection => {
  const maps = Object.fromEntries(catalogKinds.map(([name, key]) => [key, new Map(rows(protection.catalogs?.[name]).map(item => [item[key], item]))]));
  const references = [];
  const conflicts = [];
  const walk = (value, at) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${at}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (maps[key] && typeof child === 'string') {
        const item = maps[key].get(child);
        const row = { at: `${at}.${key}`, key, value: child, status: item?.status ?? null, enabled: item?.status === 'ENABLED' };
        references.push(row);
        if (!row.enabled) conflicts.push(row);
      }
      walk(child, `${at}.${key}`);
    }
  };
  for (const entry of candidateEntries) walk(entry.body, keyOf(entry.skillKey, entry.kind, entry.id));
  const passive = maps.skillCategoryKey?.get('passive');
  const required = { key: 'passive', status: passive?.status ?? null, passed: passive?.status === 'ENABLED' };
  references.push({ at: 'required.skillCategoryKeys.passive', key: 'skillCategoryKey', value: 'passive', ...required });
  if (!required.passed) conflicts.push({ at: 'required.skillCategoryKeys.passive', reason: 'passive分类缺失或未启用' });
  return { references, conflicts, required };
};

const fetchComponents = async phase => {
  const lists = [];
  const details = [];
  const conflicts = [];
  const missing = [];
  const existing = [];
  const currentKeys = new Set();
  for (const skillKey of skills) for (const [kind, key, endpoint] of kinds) {
    const route = `/skills/${encodeURIComponent(skillKey)}/${endpoint}`;
    const response = await mustGet(route);
    const items = rows(response.data);
    const ids = items.map(item => item[key]);
    if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) conflicts.push({ phase, type: '重复或非法组成键', skillKey, kind, ids });
    const listRecord = { skillKey, kind, route, status: response.status, items };
    lists.push(listRecord);
    const seenInList = new Set();
    for (const item of items) {
      const id = item[key];
      const compound = keyOf(skillKey, kind, id);
      seenInList.add(compound);
      currentKeys.add(compound);
      const detailRoute = `${route}/${encodeURIComponent(id)}`;
      const detailResponse = await mustGet(detailRoute);
      const summaryDifference = listSummaryDiff(item, detailResponse.data);
      if (summaryDifference) conflicts.push({ phase, type: '列表详情摘要不一致', skillKey, kind, id, diff: summaryDifference });
      const baselineEntry = baselineComponentByKey.get(compound);
      const candidateEntry = candidateByKey.get(compound);
      if (!baselineEntry && !candidateEntry) conflicts.push({ phase, type: '发现计划外已有组成', skillKey, kind, id });
      if (baselineEntry) {
        const listDifference = exactDiff(baselineEntry.list, item);
        const detailDifference = exactDiff(baselineEntry.detail, detailResponse.data);
        if (listDifference) conflicts.push({ phase, type: '冻结列表行漂移', skillKey, kind, id, diff: listDifference });
        if (detailDifference) conflicts.push({ phase, type: '冻结详情漂移', skillKey, kind, id, diff: detailDifference });
        existing.push({ skillKey, kind, id, classification: '冻结保护', detail: detailResponse.data });
      } else if (candidateEntry) {
        const candidateDifference = businessDiff(candidateEntry.body, detailResponse.data);
        if (candidateDifference) conflicts.push({ phase, type: '已有候选组成异值', skillKey, kind, id, diff: candidateDifference });
        existing.push({ skillKey, kind, id, classification: candidateDifference ? '已有异值' : '已有同值', detail: detailResponse.data });
      }
      details.push({ skillKey, kind, id, route: detailRoute, status: detailResponse.status, listItem: item, data: detailResponse.data, listSummaryDiff: summaryDifference });
    }
    for (const [compound, protectedEntry] of baselineComponentByKey.entries()) {
      if (protectedEntry && compound.startsWith(`${skillKey}/${kind}/`) && !seenInList.has(compound)) {
        conflicts.push({ phase, type: '冻结组成从列表消失', skillKey, kind, id: compound.slice(`${skillKey}/${kind}/`.length) });
      }
    }
    for (const entry of candidateEntries.filter(item => item.skillKey === skillKey && item.kind === kind)) {
      if (!seenInList.has(keyOf(entry.skillKey, entry.kind, entry.id))) missing.push({ ...entry });
    }
  }
  return { phase, startedAt: new Date().toISOString(), lists, details, existing, missing, conflicts, currentKeys, counts: { lists: lists.length, details: details.length, existing: existing.length, missing: missing.length }, finishedAt: new Date().toISOString() };
};

const report = {
  at: new Date().toISOString(),
  runId,
  mode: apply ? '受保护实际写入' : '只读预检',
  apiBase,
  candidateFile: candidateName,
  planFile: planName,
  candidateSha256: expected.candidateSha256,
  planSha256: expected.planSha256,
  source: 'client16.17/official16.17.1',
  expected: { catalogs: 4, characters: 4, relations: 4, subjects: 20, images: 20, lists: expected.lists, frozenDetails: expected.baselineDetails, candidateRequests: expected.requestCount },
  staticChecks,
  staticFailures,
  apiWrites: 0,
  calls: null,
  success: false,
  errors,
};
const saveReport = async () => {
  report.calls = { total: calls.length, methods: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}), statuses: calls.reduce((out, item) => { out[String(item.status)] = (out[String(item.status)] ?? 0) + 1; return out; }, {}) };
  report.apiWrites = calls.filter(item => item.method === 'POST').length;
  report.writeEvents = writeEvents.length;
  await saveJson('执行结果.json', report);
};
const writeLockPath = path.join(here, '修订一-实际写入锁.json');
let writeLockHandle = null;
let writeLock = null;
const acquireWriteLock = async () => {
  try { writeLockHandle = await fsp.open(writeLockPath, 'wx'); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('已有修订一实际写入锁，禁止并行或重放');
    throw error;
  }
  writeLock = { at: new Date().toISOString(), runId, status: 'RUNNING', candidateSha256: expected.candidateSha256, planSha256: expected.planSha256, expectedRequests: expected.requestCount, policy: '仅执行修订一候选中的158条参数、公式、效果POST；主体、关系、图片、已有组成永不写入。' };
  await writeLockHandle.writeFile(JSON.stringify(writeLock, null, 2) + '\n');
  await writeLockHandle.sync();
  await writeLockHandle.close();
  writeLockHandle = null;
};
const updateWriteLock = async (status, extra = {}) => {
  if (!writeLock) return;
  writeLock = { ...writeLock, status, ...extra, updatedAt: new Date().toISOString() };
  await fsp.writeFile(writeLockPath, JSON.stringify(writeLock, null, 2) + '\n');
};
const createPostIntent = async entry => {
  const intentDir = path.join(here, '修订一-POST意图');
  await fsp.mkdir(intentDir, { recursive: true });
  const intentKey = sha256(`${expected.candidateSha256}\n${entry.baseRoute}\n${entry.id}`);
  const file = path.join(intentDir, `${intentKey}.json`);
  try {
    const handle = await fsp.open(file, 'wx');
    try { await handle.writeFile(JSON.stringify({ at: new Date().toISOString(), candidateSha256: expected.candidateSha256, method: 'POST', route: entry.baseRoute, detailRoute: entry.detailRoute, skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id, body: entry.body }, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
    return { file, existed: false };
  } catch (error) {
    if (error.code === 'EEXIST') return { file, existed: true };
    throw error;
  }
};

let beforeProtection = null;
let beforeCatalog = null;
let beforeComponents = null;
try {
  if (staticFailures.length) throw new Error(`静态冻结校验失败${staticFailures.length}项`);
  if (apply) await acquireWriteLock();
  await appendJsonl(httpJournal, { sequence: 0, phase: '运行开始', at: new Date().toISOString(), method: 'NONE', route: null, mode: report.mode });
  beforeProtection = await fetchProtection();
  beforeCatalog = catalogReferenceCheck(beforeProtection);
  const protectionConflicts = protectionDiffs(null, beforeProtection);
  beforeComponents = await fetchComponents('写前');
  const allConflicts = [...protectionConflicts, ...beforeCatalog.conflicts, ...beforeComponents.conflicts];
  if (beforeComponents.lists.length !== expected.lists) allConflicts.push({ type: '列表数量不符', actual: beforeComponents.lists.length, expected: expected.lists });
  if (beforeComponents.details.length < expected.baselineDetails) allConflicts.push({ type: '冻结详情数量不足', actual: beforeComponents.details.length, expected: expected.baselineDetails });
  const protectedCurrent = beforeComponents.existing.filter(item => item.classification === '冻结保护').length;
  if (protectedCurrent !== expected.baselineDetails) allConflicts.push({ type: '冻结详情未全覆盖', actual: protectedCurrent, expected: expected.baselineDetails });
  const candidateSame = beforeComponents.existing.filter(item => item.classification === '已有同值').length;
  const candidateDifferent = beforeComponents.existing.filter(item => item.classification === '已有异值').length;
  report.preflight = { pass: allConflicts.length === 0, protectionConflicts: protectionConflicts.length, catalogReferences: beforeCatalog.references.length, catalogConflicts: beforeCatalog.conflicts.length, requiredCatalog: beforeCatalog.required, componentConflicts: beforeComponents.conflicts.length, conflicts: allConflicts.length, counts: beforeComponents.counts, candidateAlreadySame: candidateSame, candidateAlreadyDifferent: candidateDifferent, candidateMissing: beforeComponents.missing.length, frozenDetails: protectedCurrent };
  await saveJson('写前保护.json', beforeProtection);
  await saveJson('写前组件现值.json', { ...beforeComponents, protectionConflicts, catalogReferences: beforeCatalog.references, catalogConflicts: beforeCatalog.conflicts, allConflicts });
  await saveReport();
  if (allConflicts.length) throw new Error(`写前保护、目录或组成冲突${allConflicts.length}项`);
  if (!apply) {
    report.success = true;
    report.next = '主负责人复核修订一和本次只读GET后，设置HERO20_APPLY_CONFIRM=CONFIRM_HERO20_REVISION_ONE_POSTS并使用--apply；当前未发送POST。';
    await saveReport();
  } else {
    await appendEvent({ phase: '写入锁已取得', expectedRequests: expected.requestCount, missingBefore: beforeComponents.missing.length });
    const byKeyBefore = new Map(beforeComponents.existing.map(item => [keyOf(item.skillKey, item.kind, item.id), item]));
    const applyResult = { startedAt: new Date().toISOString(), expected: expected.requestCount, posted: 0, skippedSame: 0, confirmed: 0, stopped: false, stopReason: null };
    for (const plannedRequest of plan.requests) {
      const entry = candidateByKey.get(keyOf(plannedRequest.skillKey, plannedRequest.kind, plannedRequest.stableKey));
      if (!entry) throw new Error(`计划请求无法定位候选：${plannedRequest.skillKey}/${plannedRequest.kind}/${plannedRequest.stableKey}`);
      const existing = byKeyBefore.get(keyOf(entry.skillKey, entry.kind, entry.id));
      if (existing?.classification === '已有同值') {
        applyResult.skippedSame++;
        applyResult.confirmed++;
        await appendEvent({ phase: '逐项确认', action: '已有同值跳过POST', skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id });
        continue;
      }
      const before = await optionalDetailGet(entry.detailRoute);
      if (before.status === 200) {
        const difference = businessDiff(entry.body, before.data);
        if (difference) throw new Error(`逐项写前GET已存在异值：${entry.skillKey}/${entry.kind}/${entry.id}`);
        applyResult.skippedSame++;
        applyResult.confirmed++;
        await appendEvent({ phase: '逐项确认', action: '逐项GET发现同值跳过POST', skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id });
        continue;
      }
      const intent = await createPostIntent(entry);
      if (intent.existed) {
        applyResult.stopped = true;
        applyResult.stopReason = { phase: '防重放', skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id, intentFile: intent.file };
        await appendEvent({ ...applyResult.stopReason, action: '已有持久化POST意图且目标仍缺失，停止' });
        break;
      }
      await appendEvent({ phase: '请求前', action: '准备POST', skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id, route: entry.baseRoute, detailRoute: entry.detailRoute, intentFile: intent.file, body: entry.body });
      const post = await request('POST', entry.baseRoute, entry.body);
      applyResult.posted++;
      const after = await optionalDetailGet(entry.detailRoute);
      const difference = after.status === 200 ? businessDiff(entry.body, after.data) : { path: '$', expected: '200且与候选一致', actual: { status: after.status, data: after.data } };
      const matched = after.status === 200 && !difference;
      await appendEvent({ phase: '请求后', action: post.ok && matched ? 'POST后逐条GET通过' : 'POST或逐条GET异常，停止', skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id, postStatus: post.status, postOk: post.ok, readbackStatus: after.status, matched, diff: difference, actual: after.data });
      if (!post.ok || !matched) {
        applyResult.stopped = true;
        applyResult.stopReason = { phase: '错误后GET定位', skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.id, postStatus: post.status, postError: post.error, readbackStatus: after.status, diff: difference };
        break;
      }
      applyResult.confirmed++;
    }
    applyResult.finishedAt = new Date().toISOString();
    report.apply = applyResult;
    await saveJson('实际写入结果.json', applyResult);
    await saveReport();
    if (applyResult.stopped || applyResult.confirmed !== expected.requestCount || applyResult.posted + applyResult.skippedSame !== expected.requestCount) throw new Error('实际写入未完成158条逐项确认');
    const afterProtection = await fetchProtection();
    const drift = protectionDiffs(beforeProtection, afterProtection);
    const afterComponents = await fetchComponents('写后');
    await saveJson('写后保护.json', afterProtection);
    await saveJson('最终全量组件现值.json', afterComponents);
    report.final = { lists: afterComponents.lists.length, details: afterComponents.details.length, missing: afterComponents.missing.length, componentConflicts: afterComponents.conflicts.length, protectionDrift: drift.length, pass: afterComponents.lists.length === expected.lists && afterComponents.details.length >= expected.baselineDetails + expected.requestCount && afterComponents.missing.length === 0 && afterComponents.conflicts.length === 0 && drift.length === 0 };
    if (!report.final.pass) throw new Error('写后全量组成或保护回读未通过');
    report.success = true;
    await saveReport();
    await updateWriteLock('COMPLETED', { posted: applyResult.posted, skippedSame: applyResult.skippedSame, confirmed: applyResult.confirmed });
  }
} catch (error) {
  errors.push({ name: error.name, message: error.message });
  report.errors = errors;
  report.success = false;
  await saveReport();
  if (apply) await updateWriteLock('ABORTED', { errors, apiWrites: calls.filter(item => item.method === 'POST').length });
} finally {
  if (writeLockHandle) await writeLockHandle.close();
  await fsp.writeFile(path.join(runDir, '运行锁.json'), JSON.stringify({ at: new Date().toISOString(), runId, mode: report.mode, candidateSha256: expected.candidateSha256, planSha256: expected.planSha256, expectedRequests: apply ? expected.requestCount : 0, apiWrites: report.apiWrites, status: report.success ? 'COMPLETED' : 'ABORTED' }, null, 2) + '\n');
  report.finishedAt = new Date().toISOString();
  await saveReport();
}
console.log(JSON.stringify({ success: report.success, mode: report.mode, runId, apiWrites: report.apiWrites, calls: report.calls, preflight: report.preflight ?? null, apply: report.apply ? { posted: report.apply.posted, skippedSame: report.apply.skippedSame, confirmed: report.apply.confirmed, stopped: report.apply.stopped } : null, final: report.final ?? null, errors: report.errors, output: runDir }, null, 2));
if (!report.success) process.exitCode = 1;

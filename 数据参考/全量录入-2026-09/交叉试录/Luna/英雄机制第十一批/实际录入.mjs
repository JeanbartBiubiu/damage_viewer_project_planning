import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {fileURLToPath} from 'node:url';

// 本脚本只处理英雄11候选的缺失技能组成。默认只读，只有明确 --apply 且候选散列未变时才允许 POST。
const hereUrl = new URL('./', import.meta.url);
const herePath = fileURLToPath(hereUrl);
if(fs.existsSync(path.join(herePath,'等级曲线修正/实际修正结果.json')))throw Error('本批已保存并完成七项修正；原候选仅供历史对照，不重放新增工具');
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidatePath = path.join(herePath, '完整候选.json');
const originalPath = path.join(herePath, '写前现值.json');
const expectedCandidateFileSha256 = '98eb0627937a403ddcecd5b597469271ef5b9e074113083bac38d3572e1f2a83';
const skills = ['irelia_p','irelia_q','irelia_w','irelia_e','irelia_r','fiora_p','fiora_q','fiora_w','fiora_e','fiora_r','camille_p','camille_q','camille_w','camille_e','camille_r','gwen_p','gwen_q','gwen_w','gwen_e','gwen_r'];
const heroes = ['irelia','fiora','camille','gwen'];
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
const hash = value => createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !serverFields.has(key)).map(([key, child]) => [key, stable(child)]));
  return value;
};
const firstDiff = (expected, actual, at = '') => {
  if (equal(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') return {path: at || '$', expected, actual};
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return {path: at || '$', expected, actual};
    for (let index = 0; index < expected.length; index++) {
      const diff = firstDiff(expected[index], actual[index], `${at}[${index}]`);
      if (diff) return diff;
    }
    return {path: at || '$', expected, actual};
  }
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    if (!(key in expected) || !(key in actual)) return {path: `${at}.${key}`, expected: expected[key], actual: actual[key]};
    const diff = firstDiff(expected[key], actual[key], `${at}.${key}`);
    if (diff) return diff;
  }
  return {path: at || '$', expected, actual};
};
const rows = response => Array.isArray(response?.data) ? response.data : Array.isArray(response?.data?.items) ? response.data.items : [];
const idOf = (kind, value) => value?.[kinds.find(item => item[0] === kind)?.[1]];
const parameterValue = value => ({valueType: value?.valueType, valueMode: value?.valueMode, fixedValue: value?.fixedValue, levelValues: value?.levelValues});
const compareFull = (expected, actual) => firstDiff(stable(expected), stable(actual));
const compareParameterValue = (expected, actual) => firstDiff(parameterValue(expected), parameterValue(actual));
const listSummaryDiff = (item, detail) => {
  if (!item || !detail) return null;
  for (const [key, expected] of Object.entries(item)) {
    const actual = key === 'resultCount' ? detail.results?.length : key === 'lifecycleEnabled' ? detail.lifecycle !== null && detail.lifecycle !== undefined : detail[key];
    if (key in detail || key === 'resultCount' || key === 'lifecycleEnabled') {
      if (!equal(expected, actual)) return {path: key, expected, actual};
    }
  }
  return null;
};

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw Error('只接受默认只读或 --apply');
const apply = args.includes('--apply');
const candidateBytes = fs.readFileSync(candidatePath);
if (hash(candidateBytes) !== expectedCandidateFileSha256) throw Error('最终候选文件散列变化，拒绝执行');
const candidate = JSON.parse(candidateBytes);
const originalBytes = fs.readFileSync(originalPath);
const original = JSON.parse(originalBytes);
const candidateObjectSha256 = hash(JSON.stringify(candidate));
if (!equal(Object.keys(candidate.skills), skills)) throw Error('候选必须精确覆盖20个技能槽');
const expectedCounts = {parameters: 175, formulas: 44, effects: 16, processes: 0, internalStates: 0, triggerRules: 0};
const expectedMissingCounts = {parameters: 146, formulas: 44, effects: 16, processes: 0, internalStates: 0, triggerRules: 0};
const candidateCounts = Object.fromEntries(kinds.map(([kind]) => [kind, skills.reduce((sum, skillKey) => sum + candidate.skills[skillKey].write[kind].length, 0)]));
if (!equal(candidateCounts, expectedCounts)) throw Error(`候选组成计数不符：${JSON.stringify(candidateCounts)}`);
const originalDetails = [];
for (const skillKey of skills) for (const [kind, idField] of kinds) for (const entry of original.skills?.[skillKey]?.components?.[kind]?.details ?? []) {
  const id = entry.key ?? entry.item?.[idField] ?? entry.detail?.data?.[idField];
  const data = entry.detail?.data;
  if (id && data) originalDetails.push({skillKey, kind, id, data});
}
const originalDetailKey = new Set(originalDetails.map(entry => `${entry.skillKey}/${entry.kind}/${entry.id}`));
if (originalDetails.length !== 29) throw Error(`写前现值保护基线应有29条详情，实际${originalDetails.length}`);
const originalByKey = new Map(originalDetails.map(entry => [`${entry.skillKey}/${entry.kind}/${entry.id}`, entry.data]));
const expectedReuse = (candidate.meta?.reuseReport?.sameValueParameters ?? []).map(value => typeof value === 'string' ? value : `${value.skillKey}/${value.parameterKey}`);
if (expectedReuse.length !== 29) throw Error('候选没有记录完整的29项同值参数复用');

const token = process.env.HERO11_API_TOKEN ?? process.env.HERO10_API_TOKEN ?? '';
if (!token) throw Error('缺少进程环境中的本地开发认证占位值');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(herePath, '执行记录', runId);
await fsp.mkdir(runDir, {recursive: true});
const httpJournalPath = path.join(runDir, 'HTTP流水.jsonl');
const writeJournalPath = path.join(runDir, '写入流水.jsonl');
const calls = [];
const writeEvents = [];
const appendJsonl = async (file, value) => {
  const handle = await fsp.open(file, 'a');
  try {
    await handle.writeFile(JSON.stringify(value) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
};
const saveJson = async (name, value) => fsp.writeFile(path.join(runDir, name), JSON.stringify(value, null, 2) + '\n');

const request = async (route, {method = 'GET', body} = {}) => {
  if (!route.startsWith('/') || route.includes('://') || route.includes('..')) throw Error(`非法接口路径 ${route}`);
  if (!['GET', 'POST'].includes(method)) throw Error(`不允许的HTTP方法 ${method}`);
  if (method === 'POST') {
    const match = route.match(/^\/skills\/([^/]+)\/(parameters|formulas|effects|processes|internal-states|trigger-rules)$/);
    if (!match || !skills.includes(match[1])) throw Error(`POST超出英雄11技能组成范围 ${route}`);
    const kind = kinds.find(item => item[2] === match[2]);
    const id = body?.[kind[1]];
    const allowed = candidate.skills[match[1]].write[kind[0]].find(item => item[kind[1]] === id);
    if (!allowed || !equal(allowed, body)) throw Error(`POST不等于最终候选精确对象 ${route}`);
    if (originalDetailKey.has(`${match[1]}/${kind[0]}/${id}`)) throw Error(`禁止覆盖写前现有组成 ${route}`);
    if (!apply) throw Error('当前只读，拒绝POST');
  }
  const sequence = calls.length + 1;
  const startedAt = new Date().toISOString();
  await appendJsonl(httpJournalPath, {sequence, phase: '请求前', at: startedAt, method, route, ...(body ? {body} : {})});
  let result;
  const started = Date.now();
  try {
    const response = await fetch(apiBase + route, {
      method,
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}),
      signal: AbortSignal.timeout(30000),
    });
    const raw = await response.text();
    let data = null;
    let parseError = false;
    try { data = raw ? JSON.parse(raw) : null; } catch { parseError = true; }
    result = {route, method, status: response.status, ok: response.ok && !parseError, data, ...(parseError ? {parseError: true, responseBytes: Buffer.byteLength(raw), responseSha256: hash(raw)} : {})};
  } catch (error) {
    result = {route, method, status: null, ok: false, data: null, error: `${error.name}: ${error.message}`};
  }
  const completed = {sequence, phase: '请求后', at: new Date().toISOString(), method, route, elapsedMs: Date.now() - started, status: result.status, ok: result.ok, ...(result.error ? {error: result.error} : {}), ...(result.parseError ? {parseError: true, responseBytes: result.responseBytes, responseSha256: result.responseSha256} : {})};
  await appendJsonl(httpJournalPath, completed);
  calls.push({...result, elapsedMs: completed.elapsedMs});
  return result;
};

const protection = {catalogs: {}, relations: {}, subjects: {}, images: {}};
const getProtection = async () => {
  const out = {catalogs: {}, relations: {}, subjects: {}, images: {}};
  for (const [name] of catalogKinds) out.catalogs[name] = await request(`/${name}`);
  for (const hero of heroes) out.relations[hero] = await request(`/character-skill-relations?characterKey=champion_${hero}`);
  for (const skillKey of skills) {
    out.subjects[skillKey] = await request(`/skills/${skillKey}`);
    out.images[skillKey] = await request(`/skills/${skillKey}/representative-image`);
  }
  return out;
};

const validateProtection = (before, after, conflicts, phase) => {
  for (const [name, key] of catalogKinds) {
    const previous = rows(before.catalogs[name]);
    const current = rows(after.catalogs[name]);
    for (const item of previous) {
      const actual = current.find(value => value[key] === item[key]);
      if (!actual || !equal(stable(item), stable(actual))) conflicts.push({phase, type: 'catalog', name, key: item[key], diff: firstDiff(stable(item), stable(actual))});
    }
  }
  for (const skillKey of skills) {
    const oldSubject = before.subjects[skillKey];
    const newSubject = after.subjects[skillKey];
    if (!newSubject.ok || !equal(stable(oldSubject.data), stable(newSubject.data))) conflicts.push({phase, type: 'subject', skillKey, diff: firstDiff(stable(oldSubject.data), stable(newSubject.data))});
    const expectedImage = before.images[skillKey];
    const actualImage = after.images[skillKey];
    if (!actualImage.ok || !equal(stable(expectedImage.data), stable(actualImage.data))) conflicts.push({phase, type: 'image', skillKey, diff: firstDiff(stable(expectedImage.data), stable(actualImage.data))});
  }
  for (const hero of heroes) {
    const expectedRelation = before.relations[hero];
    const actualRelation = after.relations[hero];
    if (!actualRelation.ok || !equal(stable(expectedRelation.data), stable(actualRelation.data))) conflicts.push({phase, type: 'relation', hero, diff: firstDiff(stable(expectedRelation.data), stable(actualRelation.data))});
  }
};

const validateAgainstHistorical = (before, conflicts) => {
  for (const [name, key] of catalogKinds) {
    const current = rows(before.catalogs[name]);
    for (const oldItem of rows(original.catalogs?.[name])) {
      const actual = current.find(item => item[key] === oldItem[key]);
      if (!actual || !equal(stable(oldItem), stable(actual))) conflicts.push({phase: '写前历史目录', type: 'catalog', name, key: oldItem[key], diff: firstDiff(stable(oldItem), stable(actual))});
    }
  }
  for (const skillKey of skills) {
    const oldSubject = original.skills?.[skillKey]?.subject?.data;
    const actual = before.subjects[skillKey]?.data;
    if (!actual || !equal(stable(oldSubject), stable(actual))) conflicts.push({phase: '写前历史主体', type: 'subject', skillKey, diff: firstDiff(stable(oldSubject), stable(actual))});
    if (actual?.maxLevel !== candidate.skills[skillKey].maxLevel) conflicts.push({phase: '候选主体等级', type: 'subject', skillKey, expected: candidate.skills[skillKey].maxLevel, actual: actual?.maxLevel});
  }
};

const validateCatalogReferences = (protectionResult, conflicts) => {
  const indexes = Object.fromEntries(catalogKinds.map(([name, key]) => [key, new Map(rows(protectionResult.catalogs[name]).map(item => [item[key], item]))]));
  const referenced = [];
  const walk = (value, location) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${location}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (indexes[key] && typeof child === 'string') {
        const item = indexes[key].get(child);
        referenced.push({location: `${location}.${key}`, key, value: child, enabled: item?.status === 'ENABLED'});
        if (!item || item.status !== 'ENABLED') conflicts.push({phase: '目录引用', type: 'catalogReference', location: `${location}.${key}`, key, value: child});
      }
      walk(child, `${location}.${key}`);
    }
  };
  for (const skillKey of skills) walk(candidate.skills[skillKey].write, skillKey);
  return referenced;
};

const oldListItems = (skillKey, kind) => original.skills?.[skillKey]?.components?.[kind]?.items ?? [];
const fetchComponents = async (protectionResult, phase) => {
  const snapshot = {phase, startedAt: new Date().toISOString(), subjects: {}, lists: [], details: [], skills: {}, missing: [], conflicts: [], existing: [], counts: {lists: 0, details: 0, existing: 0, missing: 0}};
  for (const skillKey of skills) {
    snapshot.subjects[skillKey] = protectionResult.subjects[skillKey];
    snapshot.skills[skillKey] = {components: {}};
    for (const [kind, idField, apiKind] of kinds) {
      const base = `/skills/${skillKey}/${apiKind}`;
      const list = await request(base);
      const items = rows(list);
      snapshot.counts.lists++;
      snapshot.lists.push({skillKey, kind, route: base, status: list.status, items});
      const byId = new Map();
      if (!list.ok || !Array.isArray(list.data) && !Array.isArray(list.data?.items)) {
        snapshot.conflicts.push({phase, type: 'componentList', skillKey, kind, status: list.status});
      }
      if (phase === '写前') {
        const oldItems = oldListItems(skillKey, kind);
        for (const oldItem of oldItems) {
          const actual = items.find(item => item[idField] === oldItem[idField]);
          if (!actual || !equal(stable(oldItem), stable(actual))) snapshot.conflicts.push({phase, type: 'historicalList', skillKey, kind, id: oldItem[idField], diff: firstDiff(stable(oldItem), stable(actual))});
        }
      }
      if (new Set(items.map(item => item[idField])).size !== items.length || items.some(item => typeof item[idField] !== 'string')) snapshot.conflicts.push({phase, type: 'duplicateOrInvalidKey', skillKey, kind});
      for (const item of items) {
        const id = item[idField];
        const route = `${base}/${encodeURIComponent(id)}`;
        const detail = await request(route);
        const record = {skillKey, kind, id, route, status: detail.status, data: detail.data, listItem: item, listSummaryDiff: null};
        snapshot.counts.details++;
        if (detail.ok) {
          record.listSummaryDiff = listSummaryDiff(item, detail.data);
          if (record.listSummaryDiff) snapshot.conflicts.push({phase, type: 'listSummary', skillKey, kind, id, diff: record.listSummaryDiff});
        } else snapshot.conflicts.push({phase, type: 'componentDetail', skillKey, kind, id, status: detail.status, error: detail.error});
        snapshot.details.push(record);
        byId.set(id, record);
      }
      const expected = candidate.skills[skillKey].write[kind];
      const expectedById = new Map(expected.map(item => [item[idField], item]));
      for (const record of snapshot.details.filter(item => item.skillKey === skillKey && item.kind === kind)) {
        const expectedBody = expectedById.get(record.id);
        const oldBody = originalByKey.get(`${skillKey}/${kind}/${record.id}`);
        if (!expectedBody) {
          snapshot.conflicts.push({phase, type: 'unexpectedExisting', skillKey, kind, id: record.id});
          continue;
        }
        if (!record.data) continue;
        if (oldBody) {
          const oldDiff = compareFull(oldBody, record.data);
          if (oldDiff) snapshot.conflicts.push({phase, type: 'protectedOriginalChanged', skillKey, kind, id: record.id, diff: oldDiff});
          const valueDiff = kind === 'parameters' ? compareParameterValue(expectedBody, record.data) : compareFull(expectedBody, record.data);
          if (valueDiff) snapshot.conflicts.push({phase, type: 'existingValueMismatch', skillKey, kind, id: record.id, diff: valueDiff});
          snapshot.existing.push({skillKey, kind, id: record.id, classification: '保护并复用', candidateMetadataDiff: compareFull(expectedBody, record.data), oldProtected: true});
        } else {
          const candidateDiff = compareFull(expectedBody, record.data);
          if (candidateDiff) snapshot.conflicts.push({phase, type: 'existingCandidateMismatch', skillKey, kind, id: record.id, diff: candidateDiff});
          snapshot.existing.push({skillKey, kind, id: record.id, classification: candidateDiff ? '现值异值' : '同值复用', candidateMetadataDiff: candidateDiff, oldProtected: false});
        }
      }
      const currentIds = new Set(items.map(item => item[idField]));
      for (const body of expected) {
        const id = body[idField];
        if (!currentIds.has(id)) {
          const missing = {skillKey, kind, id, idField, base, route: `${base}/${encodeURIComponent(id)}`, body};
          snapshot.missing.push(missing);
        }
      }
      snapshot.skills[skillKey].components[kind] = {list, items, details: snapshot.details.filter(item => item.skillKey === skillKey && item.kind === kind), missing: snapshot.missing.filter(item => item.skillKey === skillKey && item.kind === kind)};
    }
  }
  snapshot.counts.existing = snapshot.existing.length;
  snapshot.counts.missing = snapshot.missing.length;
  snapshot.finishedAt = new Date().toISOString();
  return snapshot;
};

const expectedMissingByKind = missing => Object.fromEntries(kinds.map(([kind]) => [kind, missing.filter(item => item.kind === kind).length]));
const hasPreflightConflicts = (protectionResult, componentSnapshot) => {
  const counts = expectedMissingByKind(componentSnapshot.missing);
  const badCounts = firstDiff(expectedMissingCounts, counts);
  if (badCounts) componentSnapshot.conflicts.push({phase: '写前计数', type: 'missingCount', diff: badCounts});
  if (componentSnapshot.existing.length !== 29) componentSnapshot.conflicts.push({phase: '写前复用计数', type: 'existingCount', expected: 29, actual: componentSnapshot.existing.length});
  const actualReuse = new Set(componentSnapshot.existing.filter(item => item.oldProtected).map(item => `${item.skillKey}/${item.id}`));
  for (const key of expectedReuse) if (!actualReuse.has(key)) componentSnapshot.conflicts.push({phase: '写前复用清单', type: 'reuseMissing', key});
  for (const key of actualReuse) if (!expectedReuse.includes(key)) componentSnapshot.conflicts.push({phase: '写前复用清单', type: 'reuseUnexpected', key});
  if (Object.values(protectionResult.subjects).some(value => !value.ok) || Object.values(protectionResult.images).some(value => !value.ok) || Object.values(protectionResult.relations).some(value => !value.ok) || Object.values(protectionResult.catalogs).some(value => !value.ok)) componentSnapshot.conflicts.push({phase: '写前保护读取', type: 'protectionGetFailed'});
  return componentSnapshot.conflicts.length === 0;
};

const createIntent = async entry => {
  const intentDir = path.join(herePath, '写前意图');
  await fsp.mkdir(intentDir, {recursive: true});
  const file = path.join(intentDir, `${hash(`${expectedCandidateFileSha256}\n${entry.route}\n${entry.id}`)}.json`);
  try {
    const handle = await fsp.open(file, 'wx');
    try {
      await handle.writeFile(JSON.stringify({at: new Date().toISOString(), candidateFileSha256: expectedCandidateFileSha256, route: entry.route, id: entry.id, method: 'POST', body: entry.body}, null, 2) + '\n');
      await handle.sync();
    } finally { await handle.close(); }
    return {file, existed: false};
  } catch (error) {
    if (error.code === 'EEXIST') return {file, existed: true};
    throw error;
  }
};

const applyMissing = async preflight => {
  const result = {startedAt: new Date().toISOString(), events: [], failedSkills: [], confirmed: 0, postCount: 0};
  const failedSkills = new Set();
  const emit = async event => {
    const value = {at: new Date().toISOString(), ...event};
    result.events.push(value);
    writeEvents.push(value);
    await appendJsonl(writeJournalPath, value);
    await saveJson('写入结果中间态.json', result);
  };
  for (const entry of preflight.missing) {
    if (failedSkills.has(entry.skillKey)) {
      await emit({skillKey: entry.skillKey, kind: entry.kind, id: entry.id, action: '技能前项异常，跳过后续对象'});
      continue;
    }
    const before = await request(entry.route);
    if (before.status !== 404) {
      const diff = before.ok ? (entry.kind === 'parameters' && originalDetailKey.has(`${entry.skillKey}/${entry.kind}/${entry.id}`) ? {protectedOriginalUnexpected: true} : compareFull(entry.body, before.data)) : {status: before.status, error: before.error};
      if (!diff) {
        await emit({skillKey: entry.skillKey, kind: entry.kind, id: entry.id, action: '写前已同值落地，复用不重放', beforeStatus: before.status, match: true});
        result.confirmed++;
        continue;
      }
      await emit({skillKey: entry.skillKey, kind: entry.kind, id: entry.id, action: '写前异值或未知，暂停当前技能', beforeStatus: before.status, diff});
      failedSkills.add(entry.skillKey);
      continue;
    }
    const intent = await createIntent(entry);
    if (intent.existed) {
      await emit({skillKey: entry.skillKey, kind: entry.kind, id: entry.id, action: '已有写前意图且仍缺失，禁止重放', route: entry.route, intentFile: intent.file});
      failedSkills.add(entry.skillKey);
      continue;
    }
    await emit({skillKey: entry.skillKey, kind: entry.kind, id: entry.id, action: '准备创建', route: entry.base, body: entry.body, intentFile: intent.file});
    let post = null;
    try { post = await request(entry.base, {method: 'POST', body: entry.body}); } catch (error) { post = {status: null, ok: false, data: null, error: `${error.name}: ${error.message}`}; }
    result.postCount++;
    const after = await request(entry.route);
    const diff = after.ok ? compareFull(entry.body, after.data) : {status: after.status, error: after.error};
    const match = !diff;
    await emit({skillKey: entry.skillKey, kind: entry.kind, id: entry.id, action: match ? '创建后独立回读确认' : '响应后对账失败，未重放', postStatus: post.status, postOk: post.ok, postError: post.error, readbackStatus: after.status, match, diff, actual: after.data});
    if (match) result.confirmed++;
    else failedSkills.add(entry.skillKey);
  }
  result.failedSkills = [...failedSkills];
  result.finishedAt = new Date().toISOString();
  return result;
};

const report = {
  startedAt: new Date().toISOString(),
  runId,
  mode: apply ? '仅创建最终候选精确缺项' : '只读预检',
  apiBase,
  candidateFileSha256: expectedCandidateFileSha256,
  candidateObjectSha256,
  originalSnapshotSha256: hash(originalBytes),
  expected: {subjects: 20, images: 20, characterRelations: 4, catalogs: 4, total: 235, existing: 29, new: 206, newByKind: expectedMissingCounts},
  candidateCounts,
  apiWrites: 0,
  calls: null,
  success: false,
  errors: [],
};
const saveReport = async () => saveJson('执行结果.json', {...report, calls: {total: calls.length, methods: calls.reduce((out, call) => (out[call.method] = (out[call.method] ?? 0) + 1, out), {}), statuses: calls.reduce((out, call) => (out[call.status] = (out[call.status] ?? 0) + 1, out), {})}, writeEvents: writeEvents.length});

let preflightProtection = null;
let preflightComponents = null;
try {
  preflightProtection = await getProtection();
  await saveJson('写前保护.json', preflightProtection);
  const protectionConflicts = [];
  validateAgainstHistorical(preflightProtection, protectionConflicts);
  const references = validateCatalogReferences(preflightProtection, protectionConflicts);
  preflightComponents = await fetchComponents(preflightProtection, '写前');
  preflightComponents.protectionConflicts = protectionConflicts;
  preflightComponents.catalogReferences = references;
  hasPreflightConflicts(preflightProtection, preflightComponents);
  await saveJson('写前组件现值.json', preflightComponents);
  report.preflight = {protectionConflicts, catalogReferenceCount: references.length, componentCounts: preflightComponents.counts, missingByKind: expectedMissingByKind(preflightComponents.missing), conflicts: preflightComponents.conflicts.length, pass: protectionConflicts.length === 0 && preflightComponents.conflicts.length === 0};
  await saveReport();
  if (!report.preflight.pass) throw Error('写前保护、目录或组成现值存在冲突，拒绝写入');
  if (apply) {
    const applied = await applyMissing(preflightComponents);
    report.apply = {confirmed: applied.confirmed, postCount: applied.postCount, failedSkills: applied.failedSkills, events: applied.events.length, pass: applied.failedSkills.length === 0 && applied.confirmed === preflightComponents.missing.length};
    report.apiWrites = applied.postCount;
    await saveJson('实际写入结果.json', applied);
    await saveReport();
    if (!report.apply.pass) throw Error('实际补缺未全部独立回读确认');
    const postProtection = await getProtection();
    await saveJson('写后保护.json', postProtection);
    const protectionDrift = [];
    validateProtection(preflightProtection, postProtection, protectionDrift, '写后');
    const finalComponents = await fetchComponents(postProtection, '写后');
    await saveJson('最终全量组件现值.json', finalComponents);
    const finalExpectedCounts = Object.fromEntries(kinds.map(([kind]) => [kind, finalComponents.details.filter(item => item.kind === kind && item.status === 200).length]));
    const finalChecks = {totalDetails: finalComponents.details.length, successfulDetails: finalComponents.details.filter(item => item.status === 200).length, expectedTotal: 235, missing: finalComponents.missing.length, conflicts: finalComponents.conflicts.length, byKind: finalExpectedCounts, protectionDrift: protectionDrift.length};
    report.final = {counts: finalChecks, protectionDrift, pass: finalChecks.successfulDetails === 235 && finalChecks.missing === 0 && finalChecks.conflicts === 0 && protectionDrift.length === 0};
    await saveReport();
    if (!report.final.pass) throw Error('最终全量组件或保护回读未通过');
    report.success = true;
  } else report.success = true;
} catch (error) {
  report.errors.push({name: error.name, message: error.message});
} finally {
  report.finishedAt = new Date().toISOString();
  report.apiWrites = calls.filter(call => call.method === 'POST').length;
  await saveReport();
}
console.log(JSON.stringify({success: report.success, runId, apply, apiWrites: report.apiWrites, calls: calls.length, preflight: report.preflight, applyResult: report.apply ? {confirmed: report.apply.confirmed, postCount: report.apply.postCount, failedSkills: report.apply.failedSkills} : null, final: report.final ? {totalDetails: report.final.counts.totalDetails, missing: report.final.counts.missing, conflicts: report.final.counts.conflicts, protectionDrift: report.final.counts.protectionDrift} : null, errors: report.errors}));
if (!report.success) process.exitCode = 1;

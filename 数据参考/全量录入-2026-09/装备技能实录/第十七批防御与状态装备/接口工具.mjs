import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = new URL('./', import.meta.url);
export const herePath = path.dirname(fileURLToPath(import.meta.url));
export const sourceRoot = new URL('../../', here);
export const apiBaseUrl = process.env.DV_API_BASE_URL ?? 'http://127.0.0.1:8080/api/admin/games/lol';
const authHeader = process.env.DV_API_AUTH_HEADER;
export const selectedIds = [2522, 2525, 3119, 3121, 3137, 3181, 6333, 6610, 4401, 6665, 6695, 6696];
export const allowed = selectedIds.map(id => ({ equipmentKey: `item_${id}`, skillKey: `item_${id === 2522 ? `${id}_active` : `${id}_passive`}` }));
export const kinds = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules']
];
export const expectedCandidateSha256 = '8eb1c181548df3710ab525bf2997137443fe7305b5e83d5d1e452e7b5f9b9e4a';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const readJson = name => readFile(path.join(herePath, name), 'utf8').then(JSON.parse);
export const writeJson = (name, value, options = {}) => writeFile(
  path.join(herePath, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8', options
);
const sortAllowed = rows => [...rows].sort((a, b) => `${a.equipmentKey}/${a.skillKey}`.localeCompare(`${b.equipmentKey}/${b.skillKey}`));

export async function load() {
  const bytes = await readFile(path.join(herePath, '完整候选.json'));
  const plan = JSON.parse(bytes);
  assert.equal(sha256(bytes), expectedCandidateSha256, '候选 SHA256 不是已授权版本，停止写入');
  assert.deepEqual(sortAllowed(plan.objects.map(object => ({ equipmentKey: object.equipmentKey, skillKey: object.skillKey }))), sortAllowed(allowed), '候选对象越界或缺项');
  assert.equal(plan.totals.equipment, 12);
  assert.equal(plan.totals.skills, 12);
  assert.equal(plan.totals.parameters, 73);
  assert.equal(plan.totals.formulas, 24);
  assert.equal(plan.totals.effects, 0);
  assert.equal(plan.totals.processes, 0);
  assert.equal(plan.totals.internalStates, 0);
  assert.equal(plan.totals.triggerRules, 0);
  assert.equal(plan.totals.relations, 12);
  assert.equal(plan.totals.representativeImages, 12);
  const sourceBytes = await readFile(path.join(herePath, '冻结来源.json'));
  const beforeBytes = await readFile(path.join(herePath, '写前现值.json'));
  const activeSlotBytes = await readFile(path.join(herePath, '主动槽补充现值.json'));
  const source = JSON.parse(sourceBytes);
  const before = JSON.parse(beforeBytes);
  const activeSlot = JSON.parse(activeSlotBytes);
  assert.deepEqual(source.objects.map(object => object.id).sort((a, b) => a - b), [...selectedIds].sort((a, b) => a - b), '冻结来源对象越界或缺项');
  assert.deepEqual(before.objects.map(object => object.equipmentKey).sort(), selectedIds.map(id => `item_${id}`).sort(), '写前现值装备对象越界或缺项');
  const passiveBefore = before.objects.find(object => object.equipmentKey === 'item_2522');
  assert.ok(passiveBefore?.skillKeys?.includes('item_2522_passive'), '写前现值缺少2522被动槽404证据');
  assert.equal(activeSlot.route, '/skills/item_2522_active', '主动槽补充证据路由不符');
  assert.equal(activeSlot.status, 404, '主动槽补充证据不再是404，停止并重新读取');
  assert.equal(activeSlot.data?.error?.code, '404.SKILL_NOT_FOUND', '主动槽补充证据错误码不符，停止并重新读取');
  assert.equal(activeSlot.businessWrites, 0, '主动槽补充证据不是只读记录，停止');
  return { plan, before, source, activeSlot, bytes, hash: sha256(bytes), sourceHash: sha256(sourceBytes), beforeHash: sha256(beforeBytes), activeSlotHash: sha256(activeSlotBytes) };
}

export async function assertUnchanged({ hash, sourceHash, beforeHash, activeSlotHash }) {
  const [candidateBytes, sourceBytes, beforeBytes, activeSlotBytes] = await Promise.all([
    readFile(path.join(herePath, '完整候选.json')),
    readFile(path.join(herePath, '冻结来源.json')),
    readFile(path.join(herePath, '写前现值.json')),
    readFile(path.join(herePath, '主动槽补充现值.json'))
  ]);
  assert.equal(sha256(candidateBytes), hash, '候选在写入过程中变化，停止且不重放');
  assert.equal(sha256(sourceBytes), sourceHash, '冻结来源在写入过程中变化，停止');
  assert.equal(sha256(beforeBytes), beforeHash, '写前现值证据在写入过程中变化，停止');
  assert.equal(sha256(activeSlotBytes), activeSlotHash, '主动槽补充现值在写入过程中变化，停止');
}

function sourceFilePath(record) {
  if (record.文件) return new URL(`装备效果补证/${record.文件}`, sourceRoot);
  assert.ok(record.file, '来源记录缺少文件路径');
  return new URL(`装备符文/${record.file}`, sourceRoot);
}

export async function verifySources(source) {
  const checks = [];
  for (const record of source.sources) {
    const file = await readFile(sourceFilePath(record));
    if (record.文件) {
      const raw = gunzipSync(file);
      assert.equal(sha256(file), record.压缩SHA256, `冻结压缩来源摘要变化：${record.文件}`);
      assert.equal(sha256(raw), record.原始SHA256, `冻结解压来源摘要变化：${record.文件}`);
      checks.push({ file: record.文件, compressedSha256: sha256(file), rawSha256: sha256(raw) });
    } else {
      assert.equal(sha256(file), record.sha256, `官方冻结来源摘要变化：${record.file}`);
      checks.push({ file: record.file, sha256: sha256(file) });
    }
  }
  return checks;
}

function routeOwner(route) {
  const match = route.match(/^\/skills\/([^/]+)\/(parameters|formulas|effects|processes|internal-states|trigger-rules|representative-image)(?:\/|$)/);
  return match ? allowed.find(item => item.skillKey === decodeURIComponent(match[1])) : undefined;
}

function writePermitted(method, route, body) {
  if (method === 'POST' && route === '/skills') return allowed.some(item => item.skillKey === body?.skillKey);
  if (method === 'POST' && route === '/equipment-skill-relations') return allowed.some(item => item.equipmentKey === body?.equipmentKey && item.skillKey === body?.skillKey);
  const owner = routeOwner(route);
  if (!owner) return false;
  if (method === 'PUT' && route === `/skills/${encodeURIComponent(owner.skillKey)}/representative-image`) return Object.keys(body ?? {}).length === 1 && typeof body?.imageKey === 'string' && body.imageKey.length > 0;
  return method === 'POST' && kinds.some(([, , api]) => route === `/skills/${encodeURIComponent(owner.skillKey)}/${api}`);
}

export function makeRequest(allowWrite = false) {
  return async (route, { method = 'GET', body } = {}) => {
    assert.ok(authHeader, '请在进程环境中提供 DV_API_AUTH_HEADER；脚本不保存认证头');
    assert.ok(route.startsWith('/'), `非法 API 路由：${route}`);
    if (method !== 'GET') {
      if (!allowWrite) throw Error('默认只读，禁止业务写入');
      if (!writePermitted(method, route, body)) throw Error(`禁止越界写入：${method} ${route}`);
    }
    const response = await fetch(apiBaseUrl + route, {
      method,
      headers: { Authorization: authHeader, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000)
    });
    const raw = await response.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch { throw Error(`非 JSON 响应：${route} HTTP ${response.status}`); }
    }
    return { route, method, status: response.status, ok: response.ok, data };
  };
}

export const get = makeRequest(false);

export function listData(response) {
  if (!response.ok) throw Error(`${response.route} HTTP ${response.status}`);
  const items = Array.isArray(response.data) ? response.data : response.data?.items;
  assert.ok(Array.isArray(items), `列表结构不符：${response.route}`);
  if (response.data?.total != null) assert.equal(Number(response.data.total), items.length, `列表未完整读取：${response.route}`);
  return items;
}

export async function inventory(request = get) {
  const pageSize = 200;
  const map = new Map();
  let total = null;
  for (let page = 1; page <= 50; page++) {
    const response = await request(`/skills?page=${page}&pageSize=${pageSize}`);
    const items = listData(response);
    total = response.data?.total ?? total;
    for (const item of items) map.set(item.skillKey, { skillKey: item.skillKey, name: item.name, status: item.status });
    if (!items.length || items.length < pageSize || (total != null && map.size >= Number(total))) break;
    if (page === 50) throw Error('技能目录分页超过保护上限，停止');
  }
  const confirm = await request('/skills?page=1&pageSize=200');
  listData(confirm);
  if (confirm.data?.total != null && Number(confirm.data.total) !== map.size) throw Error('技能目录总数在分页读取期间变化，停止');
  return [...map.values()];
}

function normalize(value, key = '') {
  if (Array.isArray(value)) {
    const values = value.map(item => normalize(item));
    if (key === 'skillCategoryKeys') return values.sort();
    return values;
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, k)]));
  return value;
}

export function differences(expected, actual, currentPath = '', rows = []) {
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    rows.push({ path: currentPath, expected, actual, equal: Object.is(expected, actual) });
    return rows;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    rows.push({ path: `${currentPath}.length`, expected: expected?.length, actual: actual?.length, equal: Array.isArray(expected) && Array.isArray(actual) && expected.length === actual.length });
    for (let i = 0; i < Math.max(expected?.length ?? 0, actual?.length ?? 0); i++) differences(expected[i], actual[i], `${currentPath}[${i}]`, rows);
    return rows;
  }
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) differences(expected[key], actual[key], currentPath ? `${currentPath}.${key}` : key, rows);
  return rows;
}

export const same = (expected, actual) => differences(normalize(expected), normalize(actual)).every(row => row.equal);

function cleanServerFields(value, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const copy = { ...value };
  for (const key of ['gameId', 'createdAt', 'updatedAt']) delete copy[key];
  if (kind !== 'skill' && kind !== 'relation') delete copy.skillKey;
  return copy;
}

function imageCore(responseData) {
  const image = responseData && Object.hasOwn(responseData, 'image') ? responseData.image : responseData;
  if (!image || typeof image !== 'object') return null;
  return { imageKey: image.imageKey, enabled: image.enabled };
}

function relationItems(response) {
  const items = listData(response);
  assert.ok(items.every(item => item && typeof item.skillKey === 'string'), `关系项缺少技能键：${response.route}`);
  return items;
}

function expectedRelation(object) {
  return { ...object.apiPayload.relation, equipmentName: object.equipmentName, skillName: object.apiPayload.skill.name, skillStatus: object.apiPayload.skill.status };
}

export function compareEntry(object, entry, response, equipmentImageData = null) {
  if (entry.kind === 'relation') {
    if (!response.ok) return response.status === 404 ? { state: 'missing', fields: [] } : { state: 'conflict', fields: [], error: `GET HTTP ${response.status}` };
    let items;
    try { items = relationItems(response); } catch (error) { return { state: 'conflict', fields: [], error: String(error) }; }
    const permitted = allowed.filter(item => item.equipmentKey === object.equipmentKey).map(item => item.skillKey);
    if (items.some(item => !permitted.includes(item.skillKey)) || new Set(items.map(item => item.skillKey)).size !== items.length) return { state: 'conflict', fields: [], error: '关系存在批次外项或重复项' };
    const actual = items.find(item => item.skillKey === object.skillKey);
    if (!actual) return { state: 'missing', fields: [] };
    const fields = differences(normalize(expectedRelation(object)), normalize(cleanServerFields(actual, 'relation')));
    return { state: fields.every(row => row.equal) ? 'same' : 'conflict', fields };
  }
  if (entry.kind === 'image') {
    if (!response.ok) return response.status === 404 ? { state: 'missing', fields: [] } : { state: 'conflict', fields: [], error: `GET HTTP ${response.status}` };
    const actual = imageCore(response.data);
    if (!actual) return { state: 'missing', fields: [] };
    const expected = { imageKey: equipmentImageData?.image?.imageKey ?? equipmentImageData?.imageKey ?? entry.expected.imageKey, enabled: true };
    const fields = differences(normalize(expected), normalize(actual));
    return { state: fields.every(row => row.equal) ? 'same' : 'conflict', fields };
  }
  if (response.status === 404) return { state: 'missing', fields: [] };
  if (!response.ok) return { state: 'conflict', fields: [], error: `GET HTTP ${response.status}` };
  const actual = cleanServerFields(response.data, entry.kind);
  const fields = differences(normalize(entry.expected), normalize(actual));
  return { state: fields.every(row => row.equal) ? 'same' : 'conflict', fields };
}

export function entries(object) {
  const skillPath = `/skills/${encodeURIComponent(object.skillKey)}`;
  const result = [{ kind: 'skill', route: skillPath, createRoute: '/skills', method: 'POST', expected: object.apiPayload.skill }];
  for (const [kind, idField, api] of kinds) for (const body of object.apiPayload[kind]) result.push({ kind, route: `${skillPath}/${api}/${encodeURIComponent(body[idField])}`, createRoute: `${skillPath}/${api}`, method: 'POST', expected: body, idField, id: body[idField] });
  result.push({ kind: 'relation', route: `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`, createRoute: '/equipment-skill-relations', method: 'POST', expected: object.apiPayload.relation });
  result.push({ kind: 'image', route: `${skillPath}/representative-image`, createRoute: `${skillPath}/representative-image`, method: 'PUT', expected: object.apiPayload.representativeImage });
  return result.map(entry => ({ ...entry, equipmentKey: object.equipmentKey, skillKey: object.skillKey }));
}

function relationState(object, response) {
  const entry = entries(object).find(item => item.kind === 'relation');
  return compareEntry(object, entry, response);
}

async function readEquipmentProtection(object, original, request) {
  const row = { equipmentKey: object.equipmentKey, routes: [], relation: null };
  for (const route of [`/equipment/${object.equipmentKey}`, `/equipment/${object.equipmentKey}/attributes`, `/equipment/${object.equipmentKey}/representative-image`]) {
    const response = await request(route);
    const expected = original.records.find(item => item.route === route)?.data;
    assert.ok(expected, `写前现值缺少保护路由：${route}`);
    const fields = differences(normalize(cleanServerFields(expected, 'equipment')), normalize(cleanServerFields(response.data, 'equipment')));
    row.routes.push({ route, status: response.status, actual: response.data, fields, match: response.ok && fields.every(field => field.equal) });
  }
  const relationRoute = `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`;
  const relationResponse = await request(relationRoute);
  assert.ok(relationResponse.ok, `${relationRoute} HTTP ${relationResponse.status}`);
  const relationItemsActual = relationItems(relationResponse);
  row.relation = { route: relationRoute, status: relationResponse.status, actual: relationItemsActual, emptyBefore: relationItemsActual.length === 0 };
  return row;
}

export async function snapshot(plan, before, { request = get } = {}) {
  const out = { at: new Date().toISOString(), inventory: await inventory(request), catalogs: [], objects: [], conflicts: [], missing: [], sameCount: 0, fieldCount: 0, deferred: [] };
  for (const name of ['attributes', 'modifier-zones', 'skill-categories']) {
    const response = await request(`/${name}?page=1&pageSize=200`);
    const items = listData(response);
    out.catalogs.push({ route: response.route, status: response.status, actual: items, total: response.data?.total });
  }
  const attributeCatalog = out.catalogs.find(item => item.route.startsWith('/attributes'))?.actual ?? [];
  const zoneCatalog = out.catalogs.find(item => item.route.startsWith('/modifier-zones'))?.actual ?? [];
  for (const object of plan.objects) {
    const original = before.objects.find(item => item.equipmentKey === object.equipmentKey);
    assert.ok(original, `写前现值缺少对象：${object.equipmentKey}`);
    const row = { equipmentKey: object.equipmentKey, skillKey: object.skillKey, protection: await readEquipmentProtection(object, original, request), subject: null, componentLists: [], components: [], relation: null, image: null };
    out.objects.push(row);
    for (const route of row.protection.routes) {
      out.fieldCount += route.fields.length;
      if (!route.match) out.conflicts.push({ equipmentKey: object.equipmentKey, route: route.route, fields: route.fields.filter(field => !field.equal) });
    }
    const objectEntries = entries(object);
    const subjectEntry = objectEntries[0];
    const subjectResponse = await request(subjectEntry.route);
    if (![200, 404].includes(subjectResponse.status)) throw Error(`技能主体查询失败：${subjectEntry.route} HTTP ${subjectResponse.status}`);
    const subjectCompare = compareEntry(object, subjectEntry, subjectResponse);
    row.subject = { ...subjectResponse, state: subjectCompare.state, fields: subjectCompare.fields, error: subjectCompare.error };
    out.fieldCount += subjectCompare.fields.length;
    if (subjectCompare.state === 'conflict') out.conflicts.push({ equipmentKey: object.equipmentKey, kind: 'skill', route: subjectEntry.route, fields: subjectCompare.fields.filter(field => !field.equal), error: subjectCompare.error });
    if (subjectCompare.state === 'missing') out.missing.push(subjectEntry);
    else out.sameCount++;
    if (subjectCompare.state === 'missing') {
      if (!row.protection.relation.emptyBefore) out.conflicts.push({ equipmentKey: object.equipmentKey, route: row.protection.relation.route, error: '技能主体缺失但装备已有技能挂载，保留现值' });
      row.deferred = true;
      out.deferred.push({ equipmentKey: object.equipmentKey, components: objectEntries.filter(entry => !['skill', 'relation', 'image'].includes(entry.kind)).length, image: true });
      row.relation = { state: 'deferred', route: objectEntries.find(entry => entry.kind === 'relation').route };
      row.image = { state: 'deferred', route: objectEntries.find(entry => entry.kind === 'image').route };
      continue;
    }
    for (const [kind, idField, api] of kinds) {
      const listRoute = `/skills/${encodeURIComponent(object.skillKey)}/${api}`;
      const listResponse = await request(listRoute);
      const actualItems = listData(listResponse);
      const expectedKeys = object.apiPayload[kind].map(item => item[idField]).sort();
      const actualKeys = actualItems.map(item => item[idField]).sort();
      row.componentLists.push({ kind, route: listRoute, status: listResponse.status, actual: actualItems, expectedKeys, actualKeys, keySetMatch: same(expectedKeys, actualKeys) });
      if (!same(expectedKeys, actualKeys) || new Set(actualKeys).size !== actualKeys.length) out.conflicts.push({ equipmentKey: object.equipmentKey, kind, route: listRoute, expectedKeys, actualKeys });
      for (const body of object.apiPayload[kind]) {
        const entry = objectEntries.find(item => item.kind === kind && item.id === body[idField]);
        const response = await request(entry.route);
        const compared = compareEntry(object, entry, response);
        row.components.push({ ...entry, ...response, state: compared.state, fields: compared.fields, error: compared.error });
        out.fieldCount += compared.fields.length;
        if (compared.state === 'conflict') out.conflicts.push({ equipmentKey: object.equipmentKey, kind, route: entry.route, fields: compared.fields.filter(field => !field.equal), error: compared.error });
        else if (compared.state === 'missing') out.missing.push(entry);
        else out.sameCount++;
      }
      for (const item of actualItems.filter(item => !expectedKeys.includes(item[idField]))) row.components.push({ kind, route: `${listRoute}/${encodeURIComponent(item[idField])}`, unexpected: item });
    }
    const relationEntry = objectEntries.find(entry => entry.kind === 'relation');
    const relationResponse = await request(relationEntry.route);
    const relationCompared = relationState(object, relationResponse);
    row.relation = { ...relationResponse, state: relationCompared.state, fields: relationCompared.fields, error: relationCompared.error };
    out.fieldCount += relationCompared.fields.length;
    if (relationCompared.state === 'conflict') out.conflicts.push({ equipmentKey: object.equipmentKey, kind: 'relation', route: relationEntry.route, fields: relationCompared.fields.filter(field => !field.equal), error: relationCompared.error });
    else if (relationCompared.state === 'missing') out.missing.push(relationEntry);
    else out.sameCount++;
    const imageEntry = objectEntries.find(entry => entry.kind === 'image');
    const imageResponse = await request(imageEntry.route);
    const equipmentImage = row.protection.routes.find(item => item.route.endsWith('/representative-image'))?.actual;
    const imageCompared = compareEntry(object, imageEntry, imageResponse, equipmentImage);
    row.image = { ...imageResponse, state: imageCompared.state, fields: imageCompared.fields, error: imageCompared.error, equipmentImageKey: equipmentImage?.image?.imageKey };
    out.fieldCount += imageCompared.fields.length;
    if (imageCompared.state === 'conflict') out.conflicts.push({ equipmentKey: object.equipmentKey, kind: 'image', route: imageEntry.route, fields: imageCompared.fields.filter(field => !field.equal), error: imageCompared.error });
    else if (imageCompared.state === 'missing') out.missing.push(imageEntry);
    else out.sameCount++;
    for (const effect of object.apiPayload.effects) for (const result of effect.results ?? []) {
      if (result.detail?.attributeKey && !attributeCatalog.some(item => item.attributeKey === result.detail.attributeKey && item.status === 'ENABLED')) out.conflicts.push({ equipmentKey: object.equipmentKey, missingAttribute: result.detail.attributeKey });
      if (result.detail?.modifierZoneKey && !zoneCatalog.some(item => item.modifierZoneKey === result.detail.modifierZoneKey && item.status === 'ENABLED')) out.conflicts.push({ equipmentKey: object.equipmentKey, missingZone: result.detail.modifierZoneKey });
    }
  }
  return out;
}

export async function saveRunFile(fileName, value, flag = undefined) {
  const options = flag ? { flag } : {};
  await writeFile(path.join(herePath, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8', options);
}

export async function makeRunDirectory(runId) {
  const dir = path.join(herePath, '执行记录', runId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function appendJournal(filePath, value) {
  await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

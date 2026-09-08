import { readFile, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_VIEWER_LOCAL_BEARER;
if (!token) throw new Error('请通过环境变量 DAMAGE_VIEWER_LOCAL_BEARER 提供本地访问凭据；脚本不保存凭据');
const here = new URL('./', import.meta.url);
const candidateUrl = new URL('第三组接口候选.json', here);
const sourceUrl = new URL('第三组录入候选.json', here);
const relationUrl = new URL('../关系识别-2026-09-08T02-53-49.953Z.json', here);
const candidateBytes = await readFile(candidateUrl);
const sourceBytes = await readFile(sourceUrl);
const relationBytes = await readFile(relationUrl);
const candidate = JSON.parse(candidateBytes.toString('utf8'));
const source = JSON.parse(sourceBytes.toString('utf8'));
const relationEvidence = JSON.parse(relationBytes.toString('utf8'));
const expectedCandidateSha256 = 'b09ddbacf245676678b2a41153dbd5339d91c4a952a907dc0bce769e22e12800';
const expectedSourceSha256 = 'f8a58e18946439ae4d90d3ae49dcdb53ad84982a2d95ab443a206de539493d61';
const actualCandidateSha256 = createHash('sha256').update(candidateBytes).digest('hex');
const actualSourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (actualCandidateSha256 !== expectedCandidateSha256) throw new Error('接口候选SHA不一致，停止独立GET');
if (actualSourceSha256 !== expectedSourceSha256) throw new Error('录入候选SHA不一致，停止独立GET');

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
const outputUrl = new URL(`第三组独立GET-${stamp}.json`, here);
const report = {
  generatedAt: new Date().toISOString(),
  mode: '仅GET；独立于写入脚本重新读取全组成',
  apiBaseUrl: base,
  candidateSha256: actualCandidateSha256,
  sourceCandidateSha256: actualSourceSha256,
  relationEvidenceSha256: createHash('sha256').update(relationBytes).digest('hex'),
  objects: [],
  summary: { endpointCount: 0, okCount: 0, mismatchCount: 0, failedObjectCount: 0 },
  stopped: false
};

function ok(status) { return status >= 200 && status < 300; }
function compare(expected, actual, path = '', rows = []) {
  if (expected === null || typeof expected !== 'object') {
    rows.push({ path, expected, actual, equal: Object.is(expected, actual) });
    return rows;
  }
  if (Array.isArray(expected)) {
    const actualLength = Array.isArray(actual) ? actual.length : undefined;
    rows.push({ path: path + '.length', expected: expected.length, actual: actualLength, equal: actualLength === expected.length });
    expected.forEach((value, index) => compare(value, Array.isArray(actual) ? actual[index] : undefined, `${path}[${index}]`, rows));
    return rows;
  }
  for (const [key, value] of Object.entries(expected)) {
    const child = actual === null || actual === undefined ? undefined : actual[key];
    compare(value, child, path ? `${path}.${key}` : key, rows);
  }
  return rows;
}
function itemsOf(data) { return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []; }
async function get(path) {
  const response = await fetch(base + path, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  const raw = await response.text();
  let data = null;
  if (raw) { try { data = JSON.parse(raw); } catch { data = { rawText: raw }; } }
  report.summary.endpointCount += 1;
  if (ok(response.status)) report.summary.okCount += 1;
  return { status: response.status, data };
}
function relationFor(o) { return relationEvidence.objects.find(value => value.selectedEquipmentKey === o.equipmentKey); }
function sourceFor(o) { return source.objects.find(value => value.equipmentKey === o.equipmentKey); }
function expectedImageKey(o) { return candidate.representativeImages.find(value => value.equipmentKey === o.equipmentKey)?.imageKey; }
function recordEndpoint(record, kind, path, response, expected, actual) {
  const fields = expected === undefined ? [] : compare(expected, actual, path);
  const mismatches = fields.filter(field => !field.equal);
  if (mismatches.length) report.summary.mismatchCount += mismatches.length;
  record.endpoints.push({ kind, path, status: response.status, expected, actual, fields, matches: ok(response.status) && mismatches.length === 0 });
  if (!ok(response.status) && response.status !== 404) record.errors.push(`${path} HTTP ${response.status}`);
  if (response.status === 404) record.errors.push(`${path} 仍为404`);
}

for (const object of candidate.objects) {
  const record = { equipmentKey: object.equipmentKey, skillKey: object.skillKey, endpoints: [], errors: [], attributeKeys: [], allComponentsRead: false };
  report.objects.push(record);
  const relation = relationFor(object);
  const sourceObject = sourceFor(object);
  try {
    if (!relation || !sourceObject) throw new Error('缺少关系或来源候选对象');
    for (const probe of relation.keyProbes ?? []) {
      const response = await get('/equipment/' + encodeURIComponent(probe.key));
      const expected = probe.response.status === 200 ? probe.response.data : undefined;
      recordEndpoint(record, '同键/别名探针', '/equipment/' + probe.key, response, expected, response.data);
      if (response.status !== probe.response.status) record.errors.push(`/equipment/${probe.key} 探针状态变化`);
    }
    const equipmentPath = '/equipment/' + encodeURIComponent(object.equipmentKey);
    const equipment = await get(equipmentPath);
    recordEndpoint(record, '装备元数据', equipmentPath, equipment, relation.equipment.data, equipment.data);
    const attributesPath = equipmentPath + '/attributes';
    const attributes = await get(attributesPath);
    recordEndpoint(record, '完整直接属性', attributesPath, attributes, sourceObject.directAttributes, attributes.data?.attributeValues);
    record.attributeKeys = Object.keys(attributes.data?.attributeValues ?? {});
    const equipmentImagePath = equipmentPath + '/representative-image';
    const equipmentImage = await get(equipmentImagePath);
    recordEndpoint(record, '装备代表图', equipmentImagePath, equipmentImage, relation.representativeImage.data, equipmentImage.data);
    const skillPath = '/skills/' + encodeURIComponent(object.skillKey);
    const skill = await get(skillPath);
    recordEndpoint(record, '技能', skillPath, skill, object.apiPayload.skill, skill.data);
    for (const parameter of object.apiPayload.parameters) {
      const path = skillPath + '/parameters/' + encodeURIComponent(parameter.parameterKey);
      const response = await get(path);
      recordEndpoint(record, '参数', path, response, parameter, response.data);
    }
    const relationPath = '/equipment-skill-relations?equipmentKey=' + encodeURIComponent(object.equipmentKey);
    const relationResponse = await get(relationPath);
    const relationItems = itemsOf(relationResponse.data);
    const matching = relationItems.filter(item => item?.skillKey === object.skillKey);
    if (matching.length !== 1) record.errors.push(`关系同键数量=${matching.length}`);
    recordEndpoint(record, '装备技能挂载', relationPath, relationResponse, object.relation, matching[0]);
    const skillImagePath = skillPath + '/representative-image';
    const skillImage = await get(skillImagePath);
    recordEndpoint(record, '技能代表图复用', skillImagePath, skillImage, { imageKey: expectedImageKey(object) }, skillImage.data?.image ? { imageKey: skillImage.data.image.imageKey } : null);
    record.allComponentsRead = record.errors.length === 0 && record.endpoints.every(entry => entry.matches);
    if (!record.allComponentsRead) report.summary.failedObjectCount += 1;
  } catch (error) {
    record.errors.push(error.message);
    report.summary.failedObjectCount += 1;
  }
}
report.stopped = report.summary.failedObjectCount > 0 || report.summary.mismatchCount > 0;
await writeFile(outputUrl, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ file: outputUrl.pathname, candidateSha256: report.candidateSha256, sourceCandidateSha256: report.sourceCandidateSha256, summary: report.summary, objects: report.objects.map(o => ({ equipmentKey: o.equipmentKey, endpointCount: o.endpoints.length, allComponentsRead: o.allComponentsRead, errorCount: o.errors.length })) }, null, 2));
if (report.stopped) process.exitCode = 1;

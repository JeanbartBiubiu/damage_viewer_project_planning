import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const bytes = await readFile(new URL('./接口候选.json', import.meta.url));
const candidate = JSON.parse(bytes);
const snapshot = JSON.parse(await readFile(new URL('./录入前独立检查.json', import.meta.url), 'utf8'));
const checks = [];
const objects = [];
// 本脚本只有GET，与录入入口独立，不读取写响应充当回读。
async function get(path) {
  const response = await fetch(base + path, { method: 'GET', headers: { Authorization: 'Bearer local-entry' }, signal: AbortSignal.timeout(30000) });
  return { path, status: response.status, data: await response.json() };
}
function compare(expected, actual, path = '', fields = []) {
  if (expected === null || typeof expected !== 'object') { fields.push({ path, expected, actual, equal: Object.is(expected, actual) }); return fields; }
  if (Array.isArray(expected)) {
    fields.push({ path: `${path}.length`, expected: expected.length, actual: actual?.length, equal: Array.isArray(actual) && expected.length === actual.length });
    expected.forEach((value, index) => compare(value, actual?.[index], `${path}[${index}]`, fields)); return fields;
  }
  for (const [key, value] of Object.entries(expected)) compare(value, actual?.[key], path ? `${path}.${key}` : key, fields);
  return fields;
}
function add(kind, response, expected, actual = response.data) {
  const fields = compare(expected, actual);
  const passed = response.status >= 200 && response.status < 300 && fields.every(f => f.equal);
  checks.push({ kind, ...response, fields, passed, mismatchCount: fields.filter(f => !f.equal).length });
}
const list = data => Array.isArray(data) ? data : data?.items ?? [];
for (const object of candidate.objects) {
  const skillPath = `/skills/${object.skillKey}`;
  const payload = object.apiPayload;
  const before = snapshot.objects.find(o => o.equipmentKey === object.equipmentKey);
  for (const path of [`/equipment/${object.equipmentKey}`, `/equipment/${object.equipmentKey}/attributes`, `/equipment/${object.equipmentKey}/representative-image`]) {
    add('equipment-preserved', await get(path), before.records.find(r => r.path === path).data);
  }
  add('skill', await get(skillPath), payload.skill);
  for (const [collection, key, payloadKey] of [['parameters', 'parameterKey', 'parameters'], ['formulas', 'formulaKey', 'formulas'], ['effects', 'effectKey', 'effects'], ['trigger-rules', 'ruleKey', 'triggerRules']]) {
    for (const component of payload[payloadKey]) add(collection, await get(`${skillPath}/${collection}/${component[key]}`), component);
    const response = await get(`${skillPath}/${collection}`);
    add(`${collection}-exact-keys`, response, payload[payloadKey].map(c => c[key]).sort(), list(response.data).map(c => c[key]).sort());
  }
  const processRead = await get(`${skillPath}/processes`);
  add('no-extra-processes', processRead, [], list(processRead.data));
  const relation = candidate.relations.find(r => r.equipmentKey === object.equipmentKey);
  const relationRead = await get(`/equipment-skill-relations?equipmentKey=${object.equipmentKey}`);
  add('equipment-skill-relation', relationRead, relation, list(relationRead.data).find(r => r.skillKey === object.skillKey));
  add('relation-exact-count', relationRead, 1, list(relationRead.data).length);
  const equipmentImagePath = `/equipment/${object.equipmentKey}/representative-image`;
  const imageKey = before.records.find(r => r.path === equipmentImagePath).data.image.imageKey;
  add('skill-representative-image', await get(`${skillPath}/representative-image`), { image: { imageKey } });
  objects.push({ equipmentKey: object.equipmentKey, skillKey: object.skillKey, counts: { parameters: payload.parameters.length, formulas: payload.formulas.length, effects: payload.effects.length, triggerRules: payload.triggerRules.length }, fullEquipmentComplete: false, pending: object.omittedComponents });
}
const result = {
  generatedAt: new Date().toISOString(), apiBaseUrl: base, mode: '独立最终GET回读',
  candidateSha256: createHash('sha256').update(bytes).digest('hex'), objects, checks,
  summary: { objectCount: objects.length, checkCount: checks.length, fieldCount: checks.reduce((sum, c) => sum + c.fields.length, 0), failedCheckCount: checks.filter(c => !c.passed).length, mismatchCount: checks.reduce((sum, c) => sum + c.mismatchCount, 0), counts: candidate.counts },
  note: '逐字段独立GET，另核对每类组成的完整键集合以及装备主体、直接属性和图片关系未改动；不代表浏览器、Wasm或战斗运行验收。'
};
await writeFile(new URL('./独立最终回读.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ summary: result.summary, failed: checks.filter(c => !c.passed).map(c => ({ path: c.path, status: c.status, mismatches: c.fields.filter(f => !f.equal) })) }, null, 2));
if (result.summary.failedCheckCount) process.exitCode = 1;

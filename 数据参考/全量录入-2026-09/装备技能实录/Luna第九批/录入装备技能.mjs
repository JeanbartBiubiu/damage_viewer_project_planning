import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('仅允许无参数只读检查或--apply补缺');
const candidateBytes = await readFile(new URL('./接口候选.json', import.meta.url));
const candidate = JSON.parse(candidateBytes);
const before = JSON.parse(await readFile(new URL('./录入前独立检查.json', import.meta.url), 'utf8'));
const allowed = ['item_2502', 'item_2504', 'item_3026', 'item_3084', 'item_4632', 'item_6672'];
if (JSON.stringify(candidate.objects.map(o => o.equipmentKey)) !== JSON.stringify(allowed)) throw new Error('本批对象边界不匹配');
const outputPath = new URL(apply ? './写入执行记录.json' : './只读检查.json', import.meta.url);
const journalPath = new URL('./写入流水.jsonl', import.meta.url);
const result = { generatedAt: new Date().toISOString(), mode: apply ? '只补缺且逐写独立GET' : '只读检查', candidateSha256: createHash('sha256').update(candidateBytes).digest('hex'), apiBaseUrl: base, objects: [] };

async function request(method, path, body) {
  if (!['GET', 'POST', 'PUT'].includes(method)) throw new Error('本入口禁止删除和其他方法');
  if (method !== 'GET' && !apply) throw new Error('默认只读');
  const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer local-entry', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}
const ok = response => response.status >= 200 && response.status < 300;
const list = data => Array.isArray(data) ? data : data?.items ?? [];
function compare(expected, actual, path = '', rows = []) {
  if (expected === null || typeof expected !== 'object') { rows.push({ path, expected, actual, equal: Object.is(expected, actual) }); return rows; }
  if (Array.isArray(expected)) {
    rows.push({ path: `${path}.length`, expected: expected.length, actual: actual?.length, equal: Array.isArray(actual) && actual.length === expected.length });
    expected.forEach((v, i) => compare(v, actual?.[i], `${path}[${i}]`, rows)); return rows;
  }
  for (const [key, value] of Object.entries(expected)) compare(value, actual?.[key], path ? `${path}.${key}` : key, rows);
  return rows;
}
const snapshot = (equipmentKey, path) => before.objects.find(o => o.equipmentKey === equipmentKey).records.find(r => r.path === path);
function mustMatch(expected, actual, label) {
  const fields = compare(expected, actual);
  if (fields.some(field => !field.equal)) throw new Error(`${label}已有值不同，停止当前对象：${JSON.stringify(fields.filter(field => !field.equal))}`);
  return fields;
}
function resources(object) {
  const payload = object.apiPayload;
  const skillPath = `/skills/${object.skillKey}`;
  const entries = [{ kind: 'skill', path: skillPath, createPath: '/skills', expected: payload.skill }];
  for (const [collection, keyField, kind] of [['parameters', 'parameterKey', 'parameter'], ['formulas', 'formulaKey', 'formula'], ['effects', 'effectKey', 'effect'], ['trigger-rules', 'ruleKey', 'trigger-rule']]) {
    for (const body of payload[collection === 'trigger-rules' ? 'triggerRules' : collection]) entries.push({ kind, path: `${skillPath}/${collection}/${body[keyField]}`, createPath: `${skillPath}/${collection}`, expected: body });
  }
  entries.push({ kind: 'relation', path: `/equipment-skill-relations?equipmentKey=${object.equipmentKey}`, createPath: '/equipment-skill-relations', expected: candidate.relations.find(r => r.equipmentKey === object.equipmentKey) });
  const imageKey = snapshot(object.equipmentKey, `/equipment/${object.equipmentKey}/representative-image`).data?.image?.imageKey;
  if (!imageKey) throw new Error('写前装备代表图缺失');
  entries.push({ kind: 'representative-image', path: `${skillPath}/representative-image`, createPath: `${skillPath}/representative-image`, method: 'PUT', expected: { imageKey } });
  return entries;
}
function actualFor(entry, response) {
  if (entry.kind === 'relation') return list(response.data).find(item => item.skillKey === entry.expected.skillKey);
  if (entry.kind === 'representative-image') return response.data?.image ? { imageKey: response.data.image.imageKey } : null;
  return response.data;
}
async function persist() {
  const entries = result.objects.flatMap(o => o.components);
  result.summary = {
    objectCount: result.objects.length, failedObjectCount: result.objects.filter(o => o.error).length,
    componentCount: entries.length, createdCount: entries.filter(c => c.state === 'created').length,
    sameCount: entries.filter(c => c.state === 'same').length, missingCount: entries.filter(c => c.state === 'missing').length,
    verifiedWriteCount: entries.filter(c => c.write && c.fields?.every(f => f.equal)).length,
    mismatchCount: entries.flatMap(c => c.fields ?? []).filter(f => !f.equal).length,
    counts: Object.fromEntries(['skill', 'parameter', 'formula', 'effect', 'trigger-rule', 'relation', 'representative-image'].map(kind => [kind, entries.filter(e => e.kind === kind && ['same', 'created'].includes(e.state)).length]))
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
for (const object of candidate.objects) {
  const record = { equipmentKey: object.equipmentKey, skillKey: object.skillKey, completeEquipment: false, omittedComponents: object.omittedComponents, safeguards: [], components: [] };
  result.objects.push(record);
  try {
    if (object.skillKey !== `${object.equipmentKey}_passive`) throw new Error('技能键超出授权');
    for (const path of [`/equipment/${object.equipmentKey}`, `/equipment/${object.equipmentKey}/attributes`, `/equipment/${object.equipmentKey}/representative-image`]) {
      const current = await request('GET', path);
      if (!ok(current)) throw new Error(`装备预检失败 ${path} HTTP ${current.status}`);
      const fields = mustMatch(snapshot(object.equipmentKey, path).data, current.data, path);
      record.safeguards.push({ path, status: current.status, fields });
    }
    // 当前对象全部预检后才开始写；冲突只停止当前对象，不覆盖任何已有值。
    for (const entry of resources(object)) {
      const current = await request('GET', entry.path);
      entry.before = current;
      if (ok(current)) {
        const actual = actualFor(entry, current);
        if (actual) { entry.fields = mustMatch(entry.expected, actual, entry.path); entry.state = 'same'; }
        else entry.state = 'missing';
      } else if (current.status === 404) entry.state = 'missing';
      else throw new Error(`写前读取失败 ${entry.path} HTTP ${current.status}`);
      record.components.push(entry);
    }
    if (apply) for (const entry of record.components.filter(c => c.state === 'missing')) {
      await appendFile(journalPath, `${JSON.stringify({ at: new Date().toISOString(), phase: 'before-write', equipmentKey: object.equipmentKey, kind: entry.kind, path: entry.createPath, method: entry.method ?? 'POST', expected: entry.expected })}\n`, 'utf8');
      try { entry.write = await request(entry.method ?? 'POST', entry.createPath, entry.expected); }
      catch (error) { entry.write = { networkError: error.message }; }
      // 即使请求响应失败也先独立GET核对，不重复发写请求。
      entry.readback = await request('GET', entry.path);
      if (!ok(entry.readback)) throw new Error(`写后GET失败 ${entry.path} HTTP ${entry.readback.status}`);
      entry.fields = mustMatch(entry.expected, actualFor(entry, entry.readback), entry.path);
      entry.state = 'created';
      await appendFile(journalPath, `${JSON.stringify({ at: new Date().toISOString(), phase: 'after-independent-get', equipmentKey: object.equipmentKey, kind: entry.kind, path: entry.path, write: entry.write, readback: entry.readback, mismatchCount: 0 })}\n`, 'utf8');
      await persist();
    }
    record.status = record.components.some(c => c.state === 'missing') ? '待补缺' : '已保存可确认组成，完整装备仍待配';
  } catch (error) { record.status = '停止当前对象'; record.error = error.message; }
  await persist();
}
console.log(JSON.stringify({ mode: result.mode, summary: result.summary, failures: result.objects.filter(o => o.error).map(o => ({ equipmentKey: o.equipmentKey, error: o.error })) }, null, 2));
if (result.summary.failedObjectCount) process.exitCode = 1;

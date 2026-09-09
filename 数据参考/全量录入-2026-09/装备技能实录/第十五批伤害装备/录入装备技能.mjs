import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  apiBaseUrl,
  appendJournal,
  assertUnchanged,
  compareEntry,
  entries,
  get,
  kinds,
  load,
  makeRequest,
  makeRunDirectory,
  readJson,
  same,
  saveRunFile,
  sha256,
  snapshot,
  verifySources
} from './接口工具.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw Error('只允许默认只读或显式 --apply');
const apply = args.includes('--apply');
const loaded = await load();
const { plan, before, source, bytes, hash } = loaded;
const request = makeRequest(apply);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDirectory = await makeRunDirectory(runId);
await writeFile(path.join(runDirectory, '候选快照.json'), bytes, { flag: 'wx' });
const out = {
  runId,
  startedAt: new Date().toISOString(),
  mode: apply ? '显式补缺写入' : '默认只读预检',
  apiBaseUrl,
  candidateSha256: hash,
  sourceHash: loaded.sourceHash,
  beforeHash: loaded.beforeHash,
  events: [],
  objectStops: [],
  errors: []
};

class ObjectStop extends Error {
  constructor(equipmentKey, message) {
    super(message);
    this.equipmentKey = equipmentKey;
  }
}

class BatchStop extends Error {}

async function journal(event) {
  out.events.push(event);
  await appendJournal(path.join(runDirectory, '写入流水.jsonl'), event);
}

function originalFor(object) {
  const original = before.objects.find(item => item.equipmentKey === object.equipmentKey);
  assert.ok(original, `写前现值缺少 ${object.equipmentKey}`);
  return original;
}

function relationItems(response) {
  if (!response.ok) throw Error(`${response.route} HTTP ${response.status}`);
  const items = Array.isArray(response.data) ? response.data : response.data?.items;
  assert.ok(Array.isArray(items), `关系列表结构不符：${response.route}`);
  if (response.data?.total != null) assert.equal(Number(response.data.total), items.length, `关系列表未完整读取：${response.route}`);
  return items;
}

async function checkCoreProtection(object) {
  const original = originalFor(object);
  const checks = [];
  for (const route of [`/equipment/${object.equipmentKey}`, `/equipment/${object.equipmentKey}/attributes`, `/equipment/${object.equipmentKey}/representative-image`]) {
    const response = await request(route);
    const expected = original.records.find(item => item.route === route)?.data;
    assert.ok(expected, `写前现值缺少 ${route}`);
    const actual = response.data;
    const core = value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const copy = { ...value };
      for (const key of ['gameId', 'createdAt', 'updatedAt']) delete copy[key];
      return copy;
    };
    const match = response.ok && same(core(expected), core(actual));
    checks.push({ route, status: response.status, expected, actual, match });
    if (!match) throw new ObjectStop(object.equipmentKey, `原装备、属性或代表图现值变化：${route}`);
  }
  return checks;
}

async function writeAndRead(object, entry, equipmentImageData = null) {
  await assertUnchanged(loaded);
  await journal({ at: new Date().toISOString(), equipmentKey: object.equipmentKey, skillKey: object.skillKey, kind: entry.kind, route: entry.route, action: '准备写入', method: entry.method, createRoute: entry.createRoute, expected: entry.expected });
  let write = null;
  let writeError = null;
  try {
    write = await request(entry.createRoute, { method: entry.method, body: entry.expected });
  } catch (error) {
    writeError = String(error);
  }
  let after = null;
  let readError = null;
  try {
    after = await request(entry.route);
  } catch (error) {
    readError = String(error);
  }
  if (!after) {
    await journal({ at: new Date().toISOString(), equipmentKey: object.equipmentKey, skillKey: object.skillKey, kind: entry.kind, route: entry.route, action: '写后独立GET', write, writeError, readError, match: false });
    throw new BatchStop(`写后独立 GET 失败：${entry.route}；未重放写入`);
  }
  const result = compareEntry(object, entry, after, equipmentImageData);
  const match = result.state === 'same';
  await journal({ at: new Date().toISOString(), equipmentKey: object.equipmentKey, skillKey: object.skillKey, kind: entry.kind, route: entry.route, action: '写后独立GET', write, writeError, after, result, match });
  if (!match) throw new ObjectStop(object.equipmentKey, `写后 GET 不同值：${entry.route}；不重放写入`);
  return { after, reconciledAfterError: Boolean(writeError) };
}

async function ensureSubject(object) {
  const entry = entries(object)[0];
  const beforeResponse = await request(entry.route);
  const result = compareEntry(object, entry, beforeResponse);
  if (result.state === 'conflict') throw new ObjectStop(object.equipmentKey, `技能主体写前异值：${entry.route}`);
  if (result.state === 'same') {
    await journal({ at: new Date().toISOString(), equipmentKey: object.equipmentKey, skillKey: object.skillKey, kind: entry.kind, route: entry.route, action: '写前同值跳过', before: beforeResponse, result, match: true });
    return { created: false, response: beforeResponse };
  }
  return { created: true, response: (await writeAndRead(object, entry)).after };
}

async function validateExistingLists(object) {
  const listResults = [];
  for (const [kind, idField, api] of kinds) {
    const route = `/skills/${encodeURIComponent(object.skillKey)}/${api}`;
    const response = await request(route);
    if (!response.ok) throw new BatchStop(`组成列表读取失败：${route} HTTP ${response.status}`);
    const actual = Array.isArray(response.data) ? response.data : response.data?.items;
    if (!Array.isArray(actual)) throw new BatchStop(`组成列表结构不符：${route}`);
    if (response.data?.total != null && Number(response.data.total) !== actual.length) throw new BatchStop(`组成列表未完整读取：${route}`);
    const expectedKeys = object.apiPayload[kind].map(row => row[idField]).sort();
    const actualKeys = actual.map(row => row[idField]).sort();
    if (!same(expectedKeys, actualKeys) || new Set(actualKeys).size !== actualKeys.length) throw new ObjectStop(object.equipmentKey, `组成列表现值异值：${route}`);
    listResults.push({ kind, route, status: response.status, expectedKeys, actualKeys, actual });
  }
  return listResults;
}

async function ensureComponents(object) {
  for (const [kind, idField, api] of kinds) {
    for (const body of object.apiPayload[kind]) {
      const entry = entries(object).find(row => row.kind === kind && row.id === body[idField]);
      const beforeResponse = await request(entry.route);
      const result = compareEntry(object, entry, beforeResponse);
      if (result.state === 'conflict') throw new ObjectStop(object.equipmentKey, `组成写前异值：${entry.route}`);
      if (result.state === 'same') {
        await journal({ at: new Date().toISOString(), equipmentKey: object.equipmentKey, skillKey: object.skillKey, kind, route: entry.route, action: '写前同值跳过', before: beforeResponse, result, match: true });
      } else {
        await writeAndRead(object, entry);
      }
    }
  }
}

async function ensureRelation(object) {
  const entry = entries(object).find(row => row.kind === 'relation');
  const beforeResponse = await request(entry.route);
  const result = compareEntry(object, entry, beforeResponse);
  if (result.state === 'conflict') throw new ObjectStop(object.equipmentKey, `装备技能挂载写前异值：${entry.route}`);
  if (result.state === 'same') {
    await journal({ at: new Date().toISOString(), equipmentKey: object.equipmentKey, skillKey: object.skillKey, kind: entry.kind, route: entry.route, action: '写前同值跳过', before: beforeResponse, result, match: true });
  } else {
    await writeAndRead(object, entry);
  }
}

async function ensureImage(object, coreProtection) {
  const entry = entries(object).find(row => row.kind === 'image');
  const equipmentImage = coreProtection.find(row => row.route.endsWith('/representative-image'))?.actual;
  assert.ok(equipmentImage, `${object.equipmentKey} 缺少装备代表图现值`);
  const imageResponse = await request(entry.route);
  const result = compareEntry(object, entry, imageResponse, equipmentImage);
  if (result.state === 'conflict') throw new ObjectStop(object.equipmentKey, `技能代表图写前异图：${entry.route}`);
  if (result.state === 'same') {
    await journal({ at: new Date().toISOString(), equipmentKey: object.equipmentKey, skillKey: object.skillKey, kind: entry.kind, route: entry.route, action: '写前同值跳过', before: imageResponse, result, expectedImageKey: equipmentImage.image?.imageKey, match: true });
  } else {
    await writeAndRead(object, entry, equipmentImage);
  }
}

async function applyObject(object) {
  const protection = await checkCoreProtection(object);
  const subject = await ensureSubject(object);
  if (!subject.created) await validateExistingLists(object);
  await ensureComponents(object);
  await ensureRelation(object);
  await ensureImage(object, protection);
}

async function saveReport(fileName, value) {
  await saveRunFile(fileName, value);
  await writeFile(path.join(runDirectory, fileName), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

try {
  out.sources = await verifySources(source);
  out.preflight = await snapshot(plan, before, { request: get });
  await writeFile(path.join(runDirectory, '原始全量预检.json'), `${JSON.stringify(out.preflight, null, 2)}\n`, { flag: 'wx' });
  if (out.preflight.conflicts.length) throw new BatchStop(`全局预检存在 ${out.preflight.conflicts.length} 项冲突，整批不写`);
  const expectedWriteCount = plan.totals.skills + plan.totals.parameters + plan.totals.formulas + plan.totals.effects + plan.totals.processes + plan.totals.internalStates + plan.totals.triggerRules + plan.totals.relations + plan.totals.representativeImages;
  out.preflightSummary = {
    inventory: out.preflight.inventory.length,
    same: out.preflight.sameCount,
    missingSkills: out.preflight.missing.length,
    deferredObjects: out.preflight.deferred.length,
    conflicts: out.preflight.conflicts.length,
    expectedWriteCount
  };
  console.log(JSON.stringify({ stage: '全局预检', apply, inventory: out.preflightSummary.inventory, same: out.preflightSummary.same, missingSkills: out.preflightSummary.missingSkills, deferredObjects: out.preflightSummary.deferredObjects, conflicts: 0, expectedWriteCount }));
  if (apply) {
    await assertUnchanged(loaded);
    for (const object of plan.objects) {
      try {
        await applyObject(object);
      } catch (error) {
        if (error instanceof BatchStop) throw error;
        if (error instanceof ObjectStop) {
          out.objectStops.push({ equipmentKey: error.equipmentKey, message: String(error) });
          continue;
        }
        throw error;
      }
    }
    out.final = await snapshot(plan, before, { request: get });
    out.finalSummary = { inventory: out.final.inventory.length, same: out.final.sameCount, missing: out.final.missing.length, conflicts: out.final.conflicts.length, deferred: out.final.deferred.length };
    if (out.final.missing.length || out.final.conflicts.length || out.objectStops.length) out.errors.push({ type: 'final-validation', ...out.finalSummary, objectStops: out.objectStops });
    out.numeric = JSON.parse(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '独立数值核对.json'), 'utf8'));
  }
} catch (error) {
  out.errors.push({ message: String(error) });
} finally {
  out.finishedAt = new Date().toISOString();
  const reportName = `${apply ? '写入执行记录' : '只读检查'}-${runId}.json`;
  await saveReport(reportName, out);
}

console.log(JSON.stringify({
  mode: out.mode,
  runId,
  candidateSha256: out.candidateSha256,
  writes: out.events.filter(event => event.action === '写后独立GET' && event.write).length,
  confirmed: out.events.filter(event => event.action === '写后独立GET' && event.match).length,
  reconciledAfterError: out.events.filter(event => event.action === '写后独立GET' && event.writeError && event.match).length,
  objectStops: out.objectStops.length,
  final: out.finalSummary,
  errors: out.errors
}));
if (out.errors.length) process.exitCode = 1;

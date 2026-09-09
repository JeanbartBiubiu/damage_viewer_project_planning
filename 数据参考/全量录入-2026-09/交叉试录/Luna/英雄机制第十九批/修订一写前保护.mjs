import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

// 修订一写前保护：只发送GET，保存完整正文；遇到失败GET立即停止，不发任何业务写请求。
const here = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.HERO19_API_TOKEN ?? 'local-entry';
const heroes = [
  { id: 'Riven', key: 'riven' },
  { id: 'Aatrox', key: 'aatrox' },
  { id: 'Rengar', key: 'rengar' },
  { id: 'Khazix', key: 'khazix' },
];
const skillKeys = heroes.flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero.key}_${slot}`));
const kinds = [
  ['parameters', 'parameters', 'parameterKey'],
  ['formulas', 'formulas', 'formulaKey'],
  ['effects', 'effects', 'effectKey'],
  ['processes', 'processes', 'processKey'],
  ['internalStates', 'internal-states', 'stateKey'],
  ['triggerRules', 'trigger-rules', 'ruleKey'],
];
const catalogs = [
  ['attributes', 'attributeKey'],
  ['modifier-zones', 'modifierZoneKey'],
  ['damage-types', 'damageTypeKey'],
  ['statuses', 'statusKey'],
];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const rows = result => Array.isArray(result?.data) ? result.data : Array.isArray(result?.data?.items) ? result.data.items : [];
const requests = [];
const errors = [];

async function get(route) {
  if (!route.startsWith('/') || route.includes('://') || route.includes('..')) throw new Error(`非法GET路径：${route}`);
  const sequence = requests.length + 1;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let response;
  let result;
  try {
    response = await fetch(apiBase + route, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    const raw = await response.text();
    let data = null;
    let parseError = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (error) { parseError = `${error.name}: ${error.message}`; }
    result = {
      sequence,
      at: startedAt,
      route,
      method: 'GET',
      status: response.status,
      ok: response.ok && !parseError,
      elapsedMs: Date.now() - started,
      data,
      ...(parseError ? { parseError, rawBytes: Buffer.byteLength(raw), rawSha256: sha256(raw) } : {}),
    };
  } catch (error) {
    result = {
      sequence,
      at: startedAt,
      route,
      method: 'GET',
      status: null,
      ok: false,
      elapsedMs: Date.now() - started,
      data: null,
      error: `${error.name}: ${error.message}`,
    };
  }
  requests.push(result);
  return result;
}

async function mustGet(route, options = {}) {
  const result = await get(route);
  const allow404 = options.allow404 === true;
  if (!result.ok && !(allow404 && result.status === 404)) {
    errors.push({ route, status: result.status, reason: result.error ?? result.parseError ?? 'HTTP返回非成功状态' });
    throw new Error(`GET失败，立即停止：${route} status=${result.status ?? 'network'}`);
  }
  return result;
}

const detailKey = (skillKey, kind, id) => `${skillKey}/${kind}/${id}`;
const exactDiff = (expected, actual, at = '$') => {
  if (isDeepStrictEqual(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') return { path: at, expected, actual };
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return { path: at, expected, actual };
    for (let i = 0; i < expected.length; i++) { const child = exactDiff(expected[i], actual[i], `${at}[${i}]`); if (child) return child; }
    return null;
  }
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    if (!(key in expected) || !(key in actual)) return { path: `${at}.${key}`, expected: expected[key], actual: actual[key] };
    const child = exactDiff(expected[key], actual[key], `${at}.${key}`);
    if (child) return child;
  }
  return null;
};

const out = {
  at: new Date().toISOString(),
  mode: '修订一写前保护；全部请求为GET；完整保存20主体、120列表、已有公共详情及角色、关系、图片、共享目录；不写业务接口',
  apiBase,
  sourceVersion: 'client16.17/official16.17.1',
  heroes: heroes.map(hero => hero.id),
  skillKeys,
  catalogs: {},
  characters: {},
  relations: {},
  images: {},
  skills: {},
  requests,
  errors,
  duplicateKeys: [],
  duplicateComponents: [],
  baselineComparison: [],
};

async function main() {
  for (const [name] of catalogs) out.catalogs[name] = await mustGet(`/${name}`);
  for (const hero of heroes) {
    const characterKey = `champion_${hero.key}`;
    out.characters[hero.key] = await mustGet(`/characters/${characterKey}`);
    out.relations[hero.key] = await mustGet(`/character-skill-relations?characterKey=${encodeURIComponent(characterKey)}`);
  }
  for (const skillKey of skillKeys) {
    const subject = await mustGet(`/skills/${skillKey}`);
    const snapshot = { subject, components: {} };
    out.skills[skillKey] = snapshot;
    out.images[skillKey] = await mustGet(`/skills/${skillKey}/representative-image`, { allow404: true });
    for (const [kind, endpoint, idField] of kinds) {
      const list = await mustGet(`/skills/${skillKey}/${endpoint}`);
      const items = rows(list);
      const details = [];
      const seen = new Set();
      for (const item of items) {
        const id = item?.[idField];
        if (typeof id !== 'string' || seen.has(id)) {
          out.duplicateKeys.push({ skillKey, kind, id });
          if (seen.has(id)) out.duplicateComponents.push({ skillKey, kind, id, reason: '列表稳定键重复' });
        }
        seen.add(id);
      }
      for (const item of items) {
        const id = item?.[idField];
        if (typeof id !== 'string') continue;
        const detail = await mustGet(`/skills/${skillKey}/${endpoint}/${encodeURIComponent(id)}`);
        details.push({ id, item, detail });
      }
      snapshot.components[kind] = { list, items, details };
    }
  }

  const itemCount = skillKeys.reduce((sum, skillKey) => sum + kinds.reduce((inner, [kind]) => inner + out.skills[skillKey].components[kind].items.length, 0), 0);
  const detailCount = skillKeys.reduce((sum, skillKey) => sum + kinds.reduce((inner, [kind]) => inner + out.skills[skillKey].components[kind].details.length, 0), 0);
  const countsByKind = Object.fromEntries(kinds.map(([kind]) => [kind, skillKeys.reduce((sum, skillKey) => sum + out.skills[skillKey].components[kind].items.length, 0)]));
  const existingNonPublic = skillKeys.flatMap(skillKey => kinds.filter(([kind]) => kind !== 'parameters').flatMap(([kind, , idField]) => out.skills[skillKey].components[kind].items.map(item => ({ skillKey, kind, id: item[idField], item }))));

  // 与最初160次GET快照比较，确保候选公共参数和20主体/120列表没有在修订期间漂移。
  const baselinePath = path.join(here, '写前现值.json');
  if (fs.existsSync(baselinePath)) {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    for (const [name] of catalogs) {
      const diff = exactDiff(baseline.catalogs?.[name]?.data, out.catalogs[name]?.data);
      if (diff) out.baselineComparison.push({ type: 'catalog', name, diff });
    }
    for (const skillKey of skillKeys) {
      const subjectDiff = exactDiff(baseline.skills?.[skillKey]?.subject?.data, out.skills[skillKey].subject?.data);
      if (subjectDiff) out.baselineComparison.push({ type: 'subject', skillKey, diff: subjectDiff });
      for (const [kind] of kinds) {
        const expectedItems = baseline.skills?.[skillKey]?.components?.[kind]?.items ?? [];
        const actualItems = out.skills[skillKey].components[kind].items;
        const listDiff = exactDiff(expectedItems, actualItems);
        if (listDiff) out.baselineComparison.push({ type: 'list', skillKey, kind, diff: listDiff });
        for (const oldDetail of baseline.skills?.[skillKey]?.components?.[kind]?.details ?? []) {
          const id = oldDetail.id ?? oldDetail.item?.[kinds.find(row => row[0] === kind)?.[2]];
          const current = out.skills[skillKey].components[kind].details.find(item => item.id === id);
          const detailDiff = exactDiff(oldDetail.detail?.data, current?.detail?.data);
          if (detailDiff) out.baselineComparison.push({ type: 'detail', skillKey, kind, id, diff: detailDiff });
        }
      }
    }
  }

  out.requests = requests;
  out.errors = errors;
  out.summary = {
    skillCount: Object.keys(out.skills).length,
    expectedSkillCount: 20,
    subjectCount: Object.keys(out.skills).length,
    sixKindLists: skillKeys.length * kinds.length,
    compositionCount: itemCount,
    detailCount,
    duplicateCount: out.duplicateKeys.length,
    errorCount: errors.length,
    requestCount: requests.length,
    expectedRequestCount: 188,
    statusCounts: requests.reduce((map, request) => { const key = String(request.status); map[key] = (map[key] ?? 0) + 1; return map; }, {}),
    countsByKind,
    existingNonPublicCount: existingNonPublic.length,
    baselineConflictCount: out.baselineComparison.length,
    apiWrites: requests.some(request => request.method !== 'GET') ? 1 : 0,
  };
  out.dedup = {
    existingByKind: countsByKind,
    existingNonPublic,
    existingDetails: detailCount,
    note: '已有参数完整保护并复用；已有非公共组成只报告，候选不得覆盖或重建。'
  };

  if (out.summary.requestCount !== out.summary.expectedRequestCount) throw new Error(`预期188次GET，实际${out.summary.requestCount}次`);
  if (out.summary.errorCount !== 0 || out.summary.duplicateCount !== 0 || out.summary.existingNonPublicCount !== 0 || out.summary.baselineConflictCount !== 0 || out.summary.apiWrites !== 0) {
    throw new Error(`写前保护未通过：${JSON.stringify({ errors: out.summary.errorCount, duplicates: out.summary.duplicateCount, existingNonPublic: out.summary.existingNonPublicCount, baselineConflicts: out.summary.baselineConflictCount, apiWrites: out.summary.apiWrites })}`);
  }

  const bytes = Buffer.from(JSON.stringify(out, null, 2) + '\n');
  const target = path.join(here, '修订一写前保护.json');
  if (fs.existsSync(target)) throw new Error('修订一写前保护.json已存在，拒绝覆盖');
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  const report = {
    at: out.at,
    mode: out.mode,
    apiBase,
    sourceVersion: out.sourceVersion,
    requestCount: out.summary.requestCount,
    expectedRequestCount: out.summary.expectedRequestCount,
    statusCounts: out.summary.statusCounts,
    subjectCount: out.summary.subjectCount,
    sixKindLists: out.summary.sixKindLists,
    compositionCount: out.summary.compositionCount,
    detailCount: out.summary.detailCount,
    countsByKind: out.summary.countsByKind,
    existingNonPublicCount: out.summary.existingNonPublicCount,
    baselineConflictCount: out.summary.baselineConflictCount,
    duplicateCount: out.summary.duplicateCount,
    errorCount: out.summary.errorCount,
    apiWrites: 0,
    snapshotSha256: sha256(bytes),
    noWrites: true,
  };
  const reportPath = path.join(here, '修订一写前保护摘要.json');
  if (fs.existsSync(reportPath)) throw new Error('修订一写前保护摘要.json已存在，拒绝覆盖');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
}

try {
  await main();
} catch (error) {
  const failure = {
    at: new Date().toISOString(),
    mode: '修订一写前保护失败；已停止，不发业务写请求',
    apiBase,
    requests,
    errors: [...errors, { reason: `${error.name}: ${error.message}` }],
    apiWrites: requests.filter(request => request.method !== 'GET').length,
  };
  const failurePath = path.join(here, '修订一写前保护-失败.json');
  if (!fs.existsSync(failurePath)) fs.writeFileSync(failurePath, JSON.stringify(failure, null, 2) + '\n', { flag: 'wx' });
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}

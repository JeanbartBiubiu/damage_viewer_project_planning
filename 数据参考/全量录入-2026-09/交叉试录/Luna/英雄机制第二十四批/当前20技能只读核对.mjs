// 只读核对本批20个技能主体、目录和六类组成；不创建、修改或删除业务数据。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.HERO24_API_TOKEN ?? 'local-entry';
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
const requests = [];
const errors = [];
const get = async route => {
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(apiBase + route, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    const raw = await response.text();
    let data = null;
    let parseError = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (error) { parseError = `${error.name}: ${error.message}`; }
    const result = { route, status: response.status, ok: response.ok && !parseError, data, ...(parseError ? { parseError, rawBytes: Buffer.byteLength(raw), rawSha256: sha256(raw) } : {}) };
    requests.push({ at: startedAt, ...result });
    if (!result.ok) errors.push({ route, status: response.status, reason: parseError ?? 'HTTP返回非成功状态' });
    return result;
  } catch (error) {
    const result = { route, status: null, ok: false, data: null, error: `${error.name}: ${error.message}` };
    requests.push({ at: startedAt, ...result });
    errors.push({ route, status: null, reason: result.error });
    return result;
  }
};
const rows = result => Array.isArray(result?.data) ? result.data : Array.isArray(result?.data?.items) ? result.data.items : [];
const out = {
  at: new Date().toISOString(),
  mode: '全部请求为GET；保存完整正文；不写业务接口',
  apiBase,
  sourceVersion: 'client16.17/official16.17.1',
  heroes: heroes.map(hero => hero.id),
  skillKeys,
  catalogs: {},
  skills: {},
  requests: [],
  errors: [],
  duplicateKeys: [],
  duplicateComponents: [],
};

for (const [name] of catalogs) out.catalogs[name] = await get(`/${name}`);
for (const skillKey of skillKeys) {
  const subject = await get(`/skills/${skillKey}`);
  const snapshot = { subject, components: {} };
  for (const [kind, endpoint, idField] of kinds) {
    const list = await get(`/skills/${skillKey}/${endpoint}`);
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
      if (typeof id !== 'string') {
        details.push({ item, detail: { route: null, status: null, ok: false, data: null } });
        continue;
      }
      const detail = await get(`/skills/${skillKey}/${endpoint}/${encodeURIComponent(id)}`);
      details.push({ id, item, detail });
    }
    snapshot.components[kind] = { list, items, details };
  }
  out.skills[skillKey] = snapshot;
}
out.requests = requests;
out.errors = errors;
const items = skillKeys.flatMap(skillKey => kinds.flatMap(([kind]) => out.skills[skillKey].components[kind].items));
const details = skillKeys.flatMap(skillKey => kinds.flatMap(([kind]) => out.skills[skillKey].components[kind].details));
const existingByKind = Object.fromEntries(kinds.map(([kind]) => [kind, items.filter(item => item?.[kinds.find(row => row[0] === kind)[2]])]));
const existingNonPublic = skillKeys.flatMap(skillKey => kinds.filter(([kind]) => kind !== 'parameters').flatMap(([kind, , idField]) => out.skills[skillKey].components[kind].items.map(item => ({ skillKey, kind, id: item[idField], item }))));
out.summary = {
  skillCount: Object.keys(out.skills).length,
  expectedSkillCount: 20,
  compositionCount: items.length,
  detailCount: details.length,
  duplicateCount: out.duplicateKeys.length,
  errorCount: errors.length,
  requestCount: requests.length,
  statusCounts: requests.reduce((map, request) => { const key = String(request.status); map[key] = (map[key] ?? 0) + 1; return map; }, {}),
  countsByKind: Object.fromEntries(kinds.map(([kind]) => [kind, skillKeys.reduce((sum, skillKey) => sum + out.skills[skillKey].components[kind].items.length, 0)])),
};
out.dedup = {
  existingByKind: Object.fromEntries(kinds.map(([kind]) => [kind, existingByKind[kind].length])),
  existingNonPublic,
  note: '已有参数按逐字段正文保护后才可复用；已有公式、效果、过程、内部状态和触发规则只报告，不覆盖、不重建，候选生成继续处理其余缺项。',
};
const snapshotBytes = Buffer.from(JSON.stringify(out, null, 2) + '\n');
const snapshotPath = path.join(here, '写前现值.json');
if (fs.existsSync(snapshotPath)) throw Error('写前现值.json已存在，拒绝覆盖原始GET证据');
await fsp.writeFile(snapshotPath, snapshotBytes, { flag: 'wx' });
const report = {
  at: out.at,
  mode: out.mode,
  apiBase,
  heroes: out.heroes,
  skillCount: out.summary.skillCount,
  compositionCount: out.summary.compositionCount,
  detailCount: out.summary.detailCount,
  countsByKind: out.summary.countsByKind,
  duplicateCount: out.summary.duplicateCount,
  errorCount: out.summary.errorCount,
  requestCount: out.summary.requestCount,
  statusCounts: out.summary.statusCounts,
  existingNonPublic,
  snapshotSha256: sha256(snapshotBytes),
  noWrites: true,
};
await fsp.writeFile(path.join(here, '当前20技能组成核对.json'), JSON.stringify(report, null, 2) + '\n');
await fsp.writeFile(path.join(here, '当前20技能组成核对-完整摘要.json'), JSON.stringify({ ...report, duplicateKeys: out.duplicateKeys, errors }, null, 2) + '\n');
console.log(JSON.stringify({ success: errors.length === 0, ...report }, null, 2));
if (errors.length) process.exitCode = 1;

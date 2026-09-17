import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = 'http://127.0.0.1:8080';
const GAME_ID = 'lol';
const TOKEN = 'local-entry';
const skills = ['lux_p', 'lux_q', 'lux_w', 'lux_e', 'lux_r'];
const kinds = ['parameters', 'formulas', 'effects', 'processes', 'internal-states', 'trigger-rules'];
const snapDir = path.join(here, '修正前证据');

async function request(method, pathname) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}` }
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

function findRefs(obj, needles, pathParts, hits) {
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => findRefs(item, needles, pathParts.concat(String(i)), hits));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) findRefs(v, needles, pathParts.concat(k), hits);
    return;
  }
  if (typeof obj === 'string' && needles.includes(obj)) {
    hits.push({ needle: obj, path: pathParts.join('.') });
  }
}

function idField(kind) {
  if (kind === 'parameters') return 'parameterKey';
  if (kind === 'formulas') return 'formulaKey';
  if (kind === 'effects') return 'effectKey';
  if (kind === 'processes') return 'processKey';
  if (kind === 'internal-states') return 'stateKey';
  return 'ruleKey';
}

const needles = [
  'illumination_mark',
  'reset_ratio',
  'reset_assist_window_ms',
  'prismatic_shield',
  'mark_duration_ms',
  'base_damage'
];

const dump = { startedAt: new Date().toISOString(), skills: {}, refs: {} };
for (const n of needles) dump.refs[n] = [];

await mkdir(snapDir, { recursive: true });

for (const skillKey of skills) {
  dump.skills[skillKey] = {};
  for (const kind of kinds) {
    const listed = await request('GET', `/api/admin/games/${GAME_ID}/skills/${skillKey}/${kind}`);
    dump.skills[skillKey][kind] = { status: listed.status, items: listed.data };
    const items = Array.isArray(listed.data) ? listed.data : [];
    dump.skills[skillKey][`${kind}Details`] = {};
    for (const item of items) {
      const id = item[idField(kind)];
      const detail = await request(
        'GET',
        `/api/admin/games/${GAME_ID}/skills/${skillKey}/${kind}/${encodeURIComponent(id)}`
      );
      dump.skills[skillKey][`${kind}Details`][id] = { status: detail.status, data: detail.data };
      const hits = [];
      findRefs(detail.data, needles, [skillKey, kind, id], hits);
      for (const hit of hits) dump.refs[hit.needle].push({ skillKey, kind, id, path: hit.path });
    }
  }
}

dump.finishedAt = new Date().toISOString();
await writeFile(path.join(snapDir, 'api-现值.json'), `${JSON.stringify(dump, null, 2)}\n`, 'utf8');

const summary = {};
for (const skillKey of skills) {
  summary[skillKey] = {};
  for (const kind of kinds) {
    const items = dump.skills[skillKey][kind].items;
    summary[skillKey][kind] = {
      status: dump.skills[skillKey][kind].status,
      keys: Array.isArray(items) ? items.map((i) => i[idField(kind)]) : items
    };
  }
}
console.log(JSON.stringify({ summary, refs: dump.refs }, null, 2));

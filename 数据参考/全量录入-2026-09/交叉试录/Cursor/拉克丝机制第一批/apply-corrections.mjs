import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan } from './entry.mjs';

throw new Error('本次修正已完成，本文件仅作历史执行证据，禁止重跑。只读复核请运行 readback-final.mjs。');

const here = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = 'http://127.0.0.1:8080';
const GAME_ID = 'lol';
const TOKEN = 'local-entry';
const outDir = path.join(here, '修正变更');

async function request(method, pathname, body) {
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${TOKEN}`
  };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${pathname}`, init);
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

function skillPath(skillKey, suffix) {
  return `/api/admin/games/${GAME_ID}/skills/${encodeURIComponent(skillKey)}/${suffix}`;
}

function withoutKey(body, keyName) {
  const next = { ...body };
  delete next[keyName];
  return next;
}

const log = {
  startedAt: new Date().toISOString(),
  writes: [],
  readbacks: {},
  arithmetic: [],
  accept: {}
};

function record(step, result) {
  log.writes.push({
    step,
    status: result.status,
    ok: result.ok,
    error: result.ok ? null : result.data && result.data.error ? result.data.error : result.data
  });
  return result;
}

await mkdir(outDir, { recursive: true });

const pBase = plan.skills.lux_p.write.parameters.find((item) => item.parameterKey === 'base_damage');
const wShield = plan.skills.lux_w.write.effects.find((item) => item.effectKey === 'prismatic_shield');
const wCast = plan.skills.lux_w.write.processes.find((item) => item.processKey === 'cast');

record(
  'PUT lux_p/parameters/base_damage',
  await request('PUT', skillPath('lux_p', 'parameters/base_damage'), withoutKey(pBase, 'parameterKey'))
);

record(
  'DELETE lux_p/effects/illumination_mark',
  await request('DELETE', skillPath('lux_p', 'effects/illumination_mark'))
);

const wPutAttempt = record(
  'PUT lux_w/effects/prismatic_shield (expect instanceScope IMMUTABLE)',
  await request('PUT', skillPath('lux_w', 'effects/prismatic_shield'), withoutKey(wShield, 'effectKey'))
);
log.wPutAttempt = {
  status: wPutAttempt.status,
  field: wPutAttempt.data?.error?.details?.[0]?.field ?? wPutAttempt.data?.error?.field ?? null,
  reason: wPutAttempt.data?.error?.details?.[0]?.reason ?? wPutAttempt.data?.error?.reason ?? null,
  error: wPutAttempt.data && wPutAttempt.data.error ? wPutAttempt.data.error : wPutAttempt.data
};

if (wPutAttempt.ok) {
  log.writes.push({ step: 'lux_w shield', note: 'PUT succeeded; skip rebuild' });
} else {
  record(
    'DELETE lux_w/effects/prismatic_shield',
    await request('DELETE', skillPath('lux_w', 'effects/prismatic_shield'))
  );
  record(
    'POST lux_w/effects prismatic_shield',
    await request('POST', skillPath('lux_w', 'effects'), wShield)
  );
}

record(
  'PUT lux_w/processes/cast',
  await request('PUT', skillPath('lux_w', 'processes/cast'), withoutKey(wCast, 'processKey'))
);

record(
  'DELETE lux_r/parameters/reset_ratio',
  await request('DELETE', skillPath('lux_r', 'parameters/reset_ratio'))
);
record(
  'DELETE lux_r/parameters/reset_assist_window_ms',
  await request('DELETE', skillPath('lux_r', 'parameters/reset_assist_window_ms'))
);

const gets = [
  ['lux_p', 'parameters', 'base_damage'],
  ['lux_p', 'parameters', 'ap_ratio'],
  ['lux_p', 'parameters', 'mark_duration_ms'],
  ['lux_p', 'formulas', 'damage'],
  ['lux_p', 'effects', 'illumination_mark'],
  ['lux_w', 'effects', 'prismatic_shield'],
  ['lux_w', 'processes', 'cast'],
  ['lux_r', 'parameters', 'reset_ratio'],
  ['lux_r', 'parameters', 'reset_assist_window_ms'],
  ['lux_r', 'parameters', 'base_damage']
];

for (const [skillKey, kind, id] of gets) {
  const result = await request('GET', skillPath(skillKey, `${kind}/${id}`));
  log.readbacks[`${skillKey}/${kind}/${id}`] = { status: result.status, data: result.data };
}

const lists = [
  ['lux_p', 'effects'],
  ['lux_p', 'formulas'],
  ['lux_p', 'parameters'],
  ['lux_w', 'effects'],
  ['lux_r', 'parameters']
];
for (const [skillKey, kind] of lists) {
  const result = await request('GET', skillPath(skillKey, kind));
  const idField =
    kind === 'parameters' ? 'parameterKey' : kind === 'formulas' ? 'formulaKey' : kind === 'effects' ? 'effectKey' : 'processKey';
  log.readbacks[`${skillKey}/${kind}`] = {
    status: result.status,
    keys: Array.isArray(result.data) ? result.data.map((item) => item[idField]) : result.data
  };
}

const pLevels = log.readbacks['lux_p/parameters/base_damage'].data?.levelValues ?? {};
const wShieldAfter = log.readbacks['lux_w/effects/prismatic_shield'].data;
const ap = 100;
log.arithmetic = [
  { sample: 'P Lv1 AP0', expected: 30, actual: pLevels['1'], formula: 'base only' },
  { sample: 'P Lv18 AP0', expected: 200, actual: pLevels['18'], formula: 'base only' },
  { sample: 'P Lv1 AP100', expected: 65, actual: Number(pLevels['1']) + 0.35 * ap, formula: '30 + 0.35*100' },
  { sample: 'P Lv18 AP100', expected: 235, actual: Number(pLevels['18']) + 0.35 * ap, formula: '200 + 0.35*100' },
  { sample: 'W Lv1 AP0', expected: 40, note: 'base_shield unchanged' },
  { sample: 'W Lv5 AP0', expected: 100, note: 'base_shield unchanged' },
  { sample: 'W Lv1 AP100', expected: 80, formula: '40 + 0.4*100' },
  { sample: 'W Lv5 AP100', expected: 140, formula: '100 + 0.4*100' }
];

log.accept = {
  pLv1: pLevels['1'] === 30,
  pLv18: pLevels['18'] === 200,
  pEffectsEmpty: Array.isArray(log.readbacks['lux_p/effects'].keys) && log.readbacks['lux_p/effects'].keys.length === 0,
  pFormulaDamage: (log.readbacks['lux_p/formulas'].keys || []).includes('damage'),
  pIlluminationGone: log.readbacks['lux_p/effects/illumination_mark'].status === 404,
  wTargetSource: wShieldAfter?.results?.[0]?.target === 'SOURCE',
  wScopeSource: wShieldAfter?.lifecycle?.instanceScope === 'SOURCE',
  rResetGone: log.readbacks['lux_r/parameters/reset_ratio'].status === 404,
  rAssistGone: log.readbacks['lux_r/parameters/reset_assist_window_ms'].status === 404
};

log.finishedAt = new Date().toISOString();
await writeFile(path.join(outDir, 'writes-and-get.json'), `${JSON.stringify(log, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ writes: log.writes.map((item) => ({ step: item.step, status: item.status })), accept: log.accept, arithmetic: log.arithmetic, wPutAttempt: log.wPutAttempt }, null, 2));

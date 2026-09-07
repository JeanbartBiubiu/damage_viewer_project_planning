import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan } from './entry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = 'http://127.0.0.1:8080';
const GAME_ID = 'lol';
const TOKEN = 'local-entry';
const skills = ['lux_p', 'lux_q', 'lux_w', 'lux_e', 'lux_r'];
const kinds = ['parameters', 'formulas', 'effects', 'processes', 'internal-states', 'trigger-rules'];

async function request(pathname) {
  const res = await fetch(`${API_BASE}${pathname}`, {
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

function idField(kind) {
  if (kind === 'parameters') return 'parameterKey';
  if (kind === 'formulas') return 'formulaKey';
  if (kind === 'effects') return 'effectKey';
  if (kind === 'processes') return 'processKey';
  if (kind === 'internal-states') return 'stateKey';
  return 'ruleKey';
}

function stripMeta(value) {
  if (Array.isArray(value)) return value.map(stripMeta);
  if (value && typeof value === 'object') {
    const next = {};
    for (const key of Object.keys(value)) {
      if (
        key === 'createdAt' ||
        key === 'updatedAt' ||
        key === 'gameId' ||
        key === 'skillKey' ||
        key === 'resultCount' ||
        key === 'lifecycleEnabled' ||
        key === 'stepCount' ||
        key === 'effectBindingCount' ||
        key === 'stateOperationCount' ||
        key === 'conditionGroupCount' ||
        key === 'actionCount' ||
        key === 'perTargetCooldownEnabled' ||
        key === 'maxTriggersPerProcessEnabled' ||
        key === 'eventType'
      ) {
        continue;
      }
      next[key] = stripMeta(value[key]);
    }
    return next;
  }
  return value;
}

function differs(planned, actual, pathParts = []) {
  if (planned === actual) return null;
  if (typeof planned !== 'object' || planned === null) {
    if (planned !== actual) return { path: pathParts.join('.'), planned, actual };
    return null;
  }
  if (Array.isArray(planned)) {
    if (!Array.isArray(actual) || actual.length !== planned.length) {
      return { path: pathParts.join('.'), planned, actual };
    }
    for (let i = 0; i < planned.length; i += 1) {
      const found = differs(planned[i], actual[i], pathParts.concat(String(i)));
      if (found) return found;
    }
    return null;
  }
  if (typeof actual !== 'object' || actual === null) {
    return { path: pathParts.join('.'), planned, actual };
  }
  for (const key of Object.keys(planned)) {
    const found = differs(planned[key], actual[key], pathParts.concat(key));
    if (found) return found;
  }
  return null;
}

const summary = {
  executor: 'Cursor',
  note: '本轮为有界修正后的独立 GET 回读。Q 四个浏览器先写入对象的说明已收敛为 API 现值，不再记 occupied。',
  finishedAt: null,
  finalGet: {},
  occupiedConflicts: [],
  arithmetic: [
    { sample: 'P Lv1 AP0', expected: 30, formula: 'base_damage[1]' },
    { sample: 'P Lv18 AP0', expected: 200, formula: 'base_damage[18]' },
    { sample: 'P Lv1 AP100', expected: 65, formula: '30 + 0.35*100' },
    { sample: 'P Lv18 AP100', expected: 235, formula: '200 + 0.35*100' },
    { sample: 'W Lv1 AP0', expected: 40, formula: 'base_shield[1]' },
    { sample: 'W Lv5 AP0', expected: 100, formula: 'base_shield[5]' },
    { sample: 'W Lv1 AP100', expected: 80, formula: '40 + 0.4*100' },
    { sample: 'W Lv5 AP100', expected: 140, formula: '100 + 0.4*100' }
  ],
  auxiliaryNotBlocking: {
    note: '空间/范围/视野等辅助字段不作为 1V1 完成前置，本轮未批量删除。',
    examples: ['lux_q.target_range', 'lux_w.target_range', 'lux_e.vision_radius', 'lux_r.target_range', 'lux_r.line_width', 'lux_r.projectile_speed']
  }
};

const allEvidence = {
  executor: 'Cursor',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  apiBase: API_BASE,
  gameId: GAME_ID,
  tokenPlaceholder: 'local-entry',
  correction: 'bounded-fix-after-03001f84',
  readbacks: [],
  occupiedConflicts: [],
  failures: []
};

for (const skillKey of skills) {
  const skillPlan = plan.skills[skillKey];
  const perKind = {};
  const readbacks = [];
  const kindMap = {
    parameters: 'parameters',
    formulas: 'formulas',
    effects: 'effects',
    processes: 'processes',
    triggerRules: 'trigger-rules'
  };
  for (const [planKind, apiKind] of Object.entries(kindMap)) {
    const listed = await request(`/api/admin/games/${GAME_ID}/skills/${skillKey}/${apiKind}`);
    const items = Array.isArray(listed.data) ? listed.data : [];
    perKind[apiKind] = items.map((item) => item[idField(apiKind)]);
    for (const item of items) {
      const id = item[idField(apiKind)];
      const detail = await request(`/api/admin/games/${GAME_ID}/skills/${skillKey}/${apiKind}/${encodeURIComponent(id)}`);
      const planned = (skillPlan.write[planKind] || []).find((body) => body[idField(apiKind)] === id);
      if (planned) {
        const diff = differs(stripMeta(planned), stripMeta(detail.data));
        const rec = {
          skillKey,
          kind: planKind,
          id,
          action: 'independent-get',
          match: !diff,
          diff,
          actual: detail.data
        };
        readbacks.push(rec);
        allEvidence.readbacks.push(rec);
        if (diff) {
          allEvidence.occupiedConflicts.push({ skillKey, kind: planKind, id, diff });
          summary.occupiedConflicts.push({ skillKey, kind: planKind, id, diff });
        }
      }
    }
    const plannedIds = (skillPlan.write[planKind] || []).map((body) => body[idField(apiKind)]);
    for (const id of plannedIds) {
      if (!perKind[apiKind].includes(id)) {
        allEvidence.failures.push({ skillKey, kind: planKind, id, step: 'missing-after-correction' });
      }
    }
  }
  const internal = await request(`/api/admin/games/${GAME_ID}/skills/${skillKey}/internal-states`);
  perKind['internal-states'] = Array.isArray(internal.data)
    ? internal.data.map((item) => item.stateKey)
    : [];
  summary.finalGet[skillKey] = perKind;
  await writeFile(
    path.join(here, `回读-${skillKey}.json`),
    `${JSON.stringify(
      {
        skillKey,
        finishedAt: new Date().toISOString(),
        planned: {
          parameters: skillPlan.write.parameters.length,
          formulas: skillPlan.write.formulas.length,
          effects: skillPlan.write.effects.length,
          processes: skillPlan.write.processes.length,
          triggerRules: skillPlan.write.triggerRules.length,
          skipped: skillPlan.skipped.length
        },
        skipped: skillPlan.skipped,
        keys: perKind,
        readbacks
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

summary.finishedAt = new Date().toISOString();
allEvidence.finishedAt = summary.finishedAt;
await writeFile(path.join(here, '回读摘要.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
await writeFile(path.join(here, '逐对象回读.json'), `${JSON.stringify(allEvidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ finalGet: summary.finalGet, occupiedConflicts: summary.occupiedConflicts.length, failures: allEvidence.failures }, null, 2));

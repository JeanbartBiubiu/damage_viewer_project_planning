import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), mode = process.argv[2];
assert(['before', 'after'].includes(mode));
const token = crypto.randomUUID(), values = {}, audit = [];
async function get(route) {
  const res = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, { method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(res.status, 200, route);
  audit.push({ method: 'GET', route, status: res.status });
  return values[route] = await res.json();
}
const prefix = '/skills/chogath_w';
if (mode === 'before') {
  await get(prefix);
  for (const [collection, key] of Object.entries({ parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey', processes: 'processKey', 'internal-states': 'stateKey', 'trigger-rules': 'ruleKey' })) {
    for (const item of await get(prefix + '/' + collection)) await get(prefix + '/' + collection + '/' + item[key]);
  }
  await get('/statuses/silence');
  await get('/character-skill-relations?skillKey=chogath_w');
} else {
  const before = JSON.parse(fs.readFileSync(path.join(here, '科加斯沉默同类-只读前值.json'), 'utf8'));
  for (const [route, old] of Object.entries(before.values)) assert.deepEqual(await get(route), old, route);
}
const filename = mode === 'before' ? '科加斯沉默同类-只读前值.json' : '科加斯沉默同类-独立回读.json';
fs.writeFileSync(path.join(here, filename), JSON.stringify({ at: new Date().toISOString(), status: 'PASS', audit, values, businessWrites: 0 }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: 'PASS', mode, GETs: audit.length, businessWrites: 0 }));

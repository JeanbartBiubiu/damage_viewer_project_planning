import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), scope = process.argv[2];
assert(['q', 'w'].includes(scope));
const beforeName = scope === 'q' ? '科加斯击飞-03-独立回读-2.json' : '科加斯沉默同类-只读前值.json';
const before = JSON.parse(fs.readFileSync(path.join(here, beforeName), 'utf8'));
const token = crypto.randomUUID(), audit = [], values = {};
const withoutCheckTime = v => { const { checkedAt, ...rest } = v; return rest; };
for (const [route, old] of Object.entries(before.values)) {
  const r = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, { method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  audit.push({ method: 'GET', route, status: r.status });
  assert.equal(r.status, old.http === 404 ? 404 : 200, route);
  const value = values[route] = r.status === 404 ? { http: 404 } : await r.json();
  assert.deepEqual(route.endsWith('/authoring-check') ? withoutCheckTime(value) : value,
    route.endsWith('/authoring-check') ? withoutCheckTime(old) : old, route);
}
const proof = { at: new Date().toISOString(), status: 'PASS', scope, before: beforeName, audit, values, unchanged: true, businessWrites: 0 };
fs.writeFileSync(path.join(here, '科加斯取消修复-独立回读-' + scope + '.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: 'PASS', scope, GETs: audit.length, businessWrites: 0 }));

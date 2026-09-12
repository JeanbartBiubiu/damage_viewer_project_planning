import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..', '..');
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN');

const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const skillKeys = ['item_3047_passive', 'item_3143_passive'];
const candidateRoutes = [
  '/modifier-zones/item_3047_basic_damage_reduction',
  '/modifier-zones/item_3143_critical_damage_reduction',
  '/skills/item_3047_passive/effects/plating_basic_damage_reduction',
  '/skills/item_3047_passive/trigger-rules/initialize_plating_basic_damage_reduction',
  '/skills/item_3143_passive/effects/resilience_critical_damage_reduction',
  '/skills/item_3143_passive/trigger-rules/initialize_resilience_critical_damage_reduction'
];

const routes = ['/modifier-zones', '/damage-types'];
for (const skillKey of skillKeys) {
  routes.push(
    `/skills/${skillKey}`,
    `/skills/${skillKey}/parameters`,
    `/skills/${skillKey}/formulas`,
    `/skills/${skillKey}/effects`,
    `/skills/${skillKey}/processes`,
    `/skills/${skillKey}/internal-states`,
    `/skills/${skillKey}/trigger-rules`,
    `/skills/${skillKey}/representative-image`
  );
}
routes.push('/equipment-skill-relations?equipmentKey=item_3047', '/equipment-skill-relations?equipmentKey=item_3143', ...candidateRoutes);

async function get(route) {
  const response = await fetch(base + route, { headers: { Authorization: `Bearer ${token}` } });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { parseError: true, responseBytes: Buffer.byteLength(text) }; }
  }
  return { method: 'GET', route, status: response.status, data };
}

const requests = [];
for (const route of routes) requests.push(await get(route));
for (const item of requests) {
  const expected = candidateRoutes.includes(item.route) ? 404 : 200;
  if (item.status !== expected) throw new Error(`${item.route} 预期 ${expected}，实际 ${item.status}`);
}

const sourcePath = path.join(repo, '数据参考', 'lol-wiki-current-items', 'current-items.normalized.json');
const sourceBytes = fs.readFileSync(sourcePath);
const source = JSON.parse(sourceBytes.toString('utf8'));
const items = source.items.filter(item => [3047, 3143].includes(item.id));
if (items.length !== 2) throw new Error(`固定来源只找到 ${items.length} 项`);

const sourceSnapshot = {
  sourcePath: '数据参考/lol-wiki-current-items/current-items.normalized.json',
  normalizedSha256: crypto.createHash('sha256').update(sourceBytes).digest('hex'),
  fetchedAt: source.fetchedAt,
  items
};
const baseline = {
  capturedAt: new Date().toISOString(),
  methodPolicy: 'GET_ONLY',
  authorizationValueRecorded: false,
  getCount: requests.length,
  businessWrites: 0,
  candidateExpectedStatus: 404,
  requests
};

fs.writeFileSync(path.join(here, '03-来源快照.json'), JSON.stringify(sourceSnapshot, null, 2) + '\n');
fs.writeFileSync(path.join(here, '04-写入前现值.json'), JSON.stringify(baseline, null, 2) + '\n');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(here, file))).digest('hex');
process.stdout.write(JSON.stringify({
  status: 'PASS',
  getCount: requests.length,
  writes: 0,
  sourceSnapshotSha256: digest('03-来源快照.json'),
  baselineSha256: digest('04-写入前现值.json'),
  normalizedSha256: sourceSnapshot.normalizedSha256
}, null, 2));

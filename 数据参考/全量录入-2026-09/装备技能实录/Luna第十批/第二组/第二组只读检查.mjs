import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidate = JSON.parse(fs.readFileSync(path.join(directory, '第二组接口候选.json'), 'utf8'));
const allowed = ['item_3004', 'item_3041'];
if (JSON.stringify(candidate.objects.map(item => item.equipmentKey)) !== JSON.stringify(allowed)) {
  throw new Error('本入口只允许检查3004和3041当前真实键');
}

const bearer = process.env.DAMAGE_VIEWER_LOCAL_BEARER ?? '';

async function get(route) {
  try {
    const headers = bearer ? { Authorization: `Bearer ${bearer}` } : {};
    const response = await fetch(base + route, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { route, status: response.status, data };
  } catch (error) {
    return { route, networkError: error.message };
  }
}

const checks = [];
for (const object of candidate.objects) {
  const routes = [
    `/equipment/${object.equipmentKey}`,
    `/equipment/${object.equipmentKey}/attributes`,
    `/equipment/${object.equipmentKey}/representative-image`,
    `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`,
    `/skills/${object.skillKey}`,
    `/skills/${object.skillKey}/parameters`,
    `/skills/${object.skillKey}/formulas`,
    `/skills/${object.skillKey}/effects`,
    `/skills/${object.skillKey}/processes`,
    `/skills/${object.skillKey}/internal-states`,
    `/skills/${object.skillKey}/trigger-rules`,
    `/skills/${object.skillKey}/representative-image`,
  ];
  const results = [];
  for (const route of routes) results.push(await get(route));
  checks.push({ equipmentKey: object.equipmentKey, skillKey: object.skillKey, results });
}

const stamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 17);
const result = {
  generatedAt: new Date().toISOString(),
  mode: '只读GET',
  apiBaseUrl: base,
  candidateFile: '第二组接口候选.json',
  tokenProvidedByEnvironment: Boolean(bearer),
  objects: checks,
};
fs.writeFileSync(path.join(directory, `第二组只读检查-${stamp}.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  mode: result.mode,
  objects: checks.map(item => ({
    equipmentKey: item.equipmentKey,
    statuses: item.results.map(itemResult => itemResult.status ?? 'network-error'),
  })),
}, null, 2));

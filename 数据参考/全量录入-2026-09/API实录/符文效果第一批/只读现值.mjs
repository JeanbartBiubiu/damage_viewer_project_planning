import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv.length !== 2) throw new Error('仅允许GET，不接受执行写入参数');
const here = path.dirname(fileURLToPath(import.meta.url));
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const routes = ['/attributes', '/modifier-zones', '/skill-categories', '/skills?keyword=rune_', '/skills?keyword=符文', '/runes', ...[5005, 5007, 5010, 5011, 5013, 5008, 5001].map(id => `/rune-skill-relations?runeKey=rune_${id}`), ...[5005, 5007, 5010, 5011, 5013].map(id => `/skills/rune_${id}_passive`), '/skills/item_3004_passive/parameters', '/skills/item_3004_passive/effects/bonus_attack_damage_from_max_mana', '/skills/item_3004_passive/trigger-rules/initialize_bonus_attack_damage_from_max_mana'];
const records = [];
for (const route of routes) {
  const response = await fetch(base + route, { method: 'GET', headers: { Authorization: 'Bearer local-entry' }, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  records.push({ route, status: response.status, data });
  if (!response.ok && response.status !== 404) {
    fs.writeFileSync(path.join(here, '只读失败记录.json'), JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'GET_ONLY', records }, null, 2) + '\n');
    throw new Error(`只读失败 ${route} ${response.status}，不能推断为空`);
  }
}
fs.writeFileSync(path.join(here, '当前只读现值.json'), JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'GET_ONLY', records }, null, 2) + '\n');
for (const row of records) console.log(JSON.stringify({ route: row.route, status: row.status, total: row.data.total ?? row.data.length, data: row.route.includes('/item_3004_passive/trigger-rules/') ? row.data : undefined }));

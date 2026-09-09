import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv.length !== 2) throw new Error('目录盘点仅GET，不接受写入参数');
const here = path.dirname(fileURLToPath(import.meta.url));
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const records = [];
for (const route of ['/runes', '/skills?keyword=rune_', '/attributes', '/modifier-zones', '/statuses', '/skill-categories', '/damage-types']) {
  const response = await fetch(base + route, { method: 'GET', headers: { Authorization: 'Bearer local-entry' }, signal: AbortSignal.timeout(20000) });
  const data = await response.json(); records.push({ route, status: response.status, data });
  if (!response.ok) throw new Error(`目录读取失败:${route}:${response.status}`);
}
fs.writeFileSync(path.join(here, '当前目录.json'), JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'GET_ONLY', records }, null, 2)+'\n');
console.log(JSON.stringify(records.map(row=>({route:row.route,status:row.status,total:row.data.total??row.data.length,items:['/modifier-zones','/statuses','/skill-categories','/damage-types'].includes(row.route)?row.data.items:row.route==='/skills?keyword=rune_'?row.data.items.map(x=>({skillKey:x.skillKey,name:x.name})):undefined})),null,2));

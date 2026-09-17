import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv.length !== 2) throw new Error('本工具只允许GET，不接受apply或其他参数。');
const here = path.dirname(fileURLToPath(import.meta.url));
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const images = JSON.parse(fs.readFileSync(path.join(here, '图片候选.json'), 'utf8'));
async function get(relative) {
  try {
    const response = await fetch(`${base}${relative}`, { headers: { Authorization: 'Bearer local-entry' }, signal: AbortSignal.timeout(15000) });
    const raw = await response.text(); let data; try { data = JSON.parse(raw); } catch { data = null; }
    return { path: relative, status: response.status, data, interpretation: response.status === 404 ? '端点或对象尚未就绪，不据此判断候选冲突' : response.ok ? '只读回读' : '读取失败，禁止推断为空' };
  } catch (error) { return { path: relative, status: null, error: error.name, message: error.message, interpretation: '读取失败，禁止推断为空' }; }
}
const catalogs = [];
for (const route of ['/runes', '/rune-paths']) catalogs.push(await get(route));
const options = new Array(images.length); let cursor = 0;
await Promise.all(Array.from({ length: 3 }, async () => { while (cursor < images.length) {
  const index = cursor++, entry = images[index];
  const searches = [];
  for (const keyword of [entry.proposedImageKey, entry.name]) searches.push(await get(`/image-options?${new URLSearchParams({ keyword })}`));
  options[index] = { key: entry.key, name: entry.name, searches, note: '搜索匹配不是自动复用决定；须核对图像内容、启停、来源与当前对象，再由主任务决定。' };
} }));
const output = { generatedAt: new Date().toISOString(), mode: 'GET_ONLY', catalogs, imageSearches: options };
fs.writeFileSync(path.join(here, '写前只读现值.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ catalogs: catalogs.map(item => ({ path: item.path, status: item.status, total: item.data?.total })), searches: options.length * 2, matches: options.flatMap(item => item.searches.filter(search => search.status === 200 && search.data?.items?.length).map(search => ({ key: item.key, path: search.path, items: search.data.items }))) }, null, 2));

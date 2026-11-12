import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['viewer', 'maintenance'].includes(mode)) throw new Error('必须指定 viewer 或 maintenance 产物。');
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, mode === 'maintenance' ? 'dist-maintenance/assets' : 'dist/assets');
const paths = (await readdir(directory)).filter(file => file.endsWith('.js'));
if (!paths.length) throw new Error('构建目录没有脚本产物。');
const source = (await Promise.all(paths.map(file => readFile(resolve(directory, file), 'utf8')))).join('\n');
const privateMarkers = ['新增属性', '技能统一编辑工作区', '/internal/maintenance/', 'X-Damage-Maintenance-Batch', 'MAINTENANCE.CANDIDATE_CAPTURED'];
for (const marker of privateMarkers) {
  if (mode === 'viewer' && source.includes(marker)) throw new Error(`公共产物包含维护入口或保存逻辑：${marker}`);
  if (mode === 'maintenance' && !source.includes(marker)) throw new Error(`私有产物缺少维护能力：${marker}`);
}
console.log(`deployment artifact ok: ${mode}, ${paths.length} script file(s)`);

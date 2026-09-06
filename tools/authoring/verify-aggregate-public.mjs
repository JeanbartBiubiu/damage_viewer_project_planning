import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const [base, outputPath, baselinePath] = process.argv.slice(2);
if (!base || !outputPath || new URL(base).hostname !== '127.0.0.1') throw new Error('参数：本机服务地址 输出路径 可选迁移前记录');
async function get(path) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path);
  return response.json();
}
const games = await get('/api/games');
const images = await get('/api/games/lol/images');
const evidence = {
  games,
  imageCount: images.images.length,
  imageContentHash: createHash('sha256').update(JSON.stringify(images)).digest('hex'),
};
assert.equal(evidence.imageCount, 2127);
if (baselinePath) assert.deepEqual(evidence, JSON.parse(await fs.readFile(baselinePath, 'utf8')));
await fs.writeFile(outputPath, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ publicGames: 'passed', publicImages: 'passed', imageCount: evidence.imageCount, unchanged: Boolean(baselinePath) }));

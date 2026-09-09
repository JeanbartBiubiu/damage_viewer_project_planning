import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
if (process.argv.length !== 2) throw new Error('本工具仅下载固定公开图片，不接受写入参数。');
const here = path.dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(fs.readFileSync(path.join(here, '图片候选.json'), 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(path.join(here, '原始图片'), { recursive: true });
const reportPath = path.join(here, '图片下载记录.json');
const previous = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')).items : [];
function inspect(bytes) {
  assert(bytes.length <= 5 * 1024 * 1024); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert(width > 0 && height > 0 && width <= 4096 && height <= 4096);
  return { byteSize: bytes.length, width, height, sha256: sha(bytes) };
}
let cursor = 0;
const items = new Array(plan.length);
async function task(index) {
  const entry = plan[index], file = path.join(here, entry.rawFile), old = previous.find(row => row.key === entry.key);
  if (fs.existsSync(file) && old?.status === '下载完成') {
    const proof = inspect(fs.readFileSync(file)); assert.equal(proof.sha256, old.sha256); items[index] = old; return;
  }
  const attempts = [];
  for (const url of [entry.primaryUrl, entry.fallbackUrl].filter(Boolean)) {
    const parsed = new URL(url);
    assert(['raw.communitydragon.org', 'ddragon.leagueoflegends.com'].includes(parsed.host));
    if (parsed.host === 'raw.communitydragon.org') assert(parsed.pathname.startsWith('/16.17/'));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
      attempts.push({ url, status: response.status });
      if (!response.ok) continue;
      assert(['raw.communitydragon.org', 'ddragon.leagueoflegends.com'].includes(new URL(response.url).host));
      const bytes = Buffer.from(await response.arrayBuffer()); const proof = inspect(bytes);
      if (fs.existsSync(file)) assert.equal(sha(fs.readFileSync(file)), proof.sha256, '已有原始图片不覆盖');
      else fs.writeFileSync(file, bytes, { flag: 'wx' });
      items[index] = { key: entry.key, kind: entry.kind, name: entry.name, status: '下载完成', rawFile: entry.rawFile, url, resolvedUrl: response.url, retrievedAt: new Date().toISOString(), ...proof, attempts, boundary: parsed.host === 'raw.communitydragon.org' ? '固定16.17客户端提取资源' : '冻结16.17.1资料提供的官方完整图片URL；图片URL本身不含版本，本批下载bytes以SHA锁定' };
      return;
    } catch (error) { attempts.push({ url, error: error.name, message: error.message }); }
  }
  items[index] = { key: entry.key, kind: entry.kind, name: entry.name, status: '图片待补', attempts };
}
await Promise.all(Array.from({ length: 4 }, async () => { while (cursor < plan.length) { const index = cursor++; await task(index); } }));
const report = { checkedAt: new Date().toISOString(), counts: { expected: plan.length, downloaded: items.filter(item => item.status === '下载完成').length, pending: items.filter(item => item.status !== '下载完成').length }, items };
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ counts: report.counts, pending: items.filter(item => item.status !== '下载完成').map(item => item.key), strongAttack: items.find(item => item.key === 'rune_8005') }, null, 2));

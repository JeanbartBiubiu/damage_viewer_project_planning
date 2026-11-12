import { readFileSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeClient } from './client.mjs';
import { signReceipt } from './verify-candidate.mjs';
import { requireValue, readJson, writeNew, options, isUuid } from './artifacts.mjs';

/** 部署执行者独占：实际浏览器命令成功并核对线上身份后才签发验收。 */
export async function acceptPublic(config, directory, input, fetcher = fetch) {
  requireValue(isUuid(input.batchId) && typeof input.releaseId === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(input.releaseId)
    && typeof input.sourceRevision === 'string' && input.sourceRevision.length > 0, '验收关联身份无效。');
  const origin = new URL(config.publicOrigin);
  requireValue(origin.protocol === 'https:' && origin.origin === config.publicOrigin && !origin.username && !origin.password, '公网验收需要精确HTTPS来源。');
  const clientPath = resolve(directory, config.maintenanceConfig), client = makeClient(readJson(clientPath), dirname(clientPath));
  const batch = (await client.request('GET', `/internal/maintenance/batches/${input.batchId}`)).data;
  requireValue(batch.state === 'COMPLETE', '维护批次尚未完成，不签发公网验收。');
  const release = await fetcher(`${origin.origin}/release.json`, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  requireValue(release.ok && (await release.json()).releaseId === input.releaseId, '公网发布身份不匹配。');
  const command = config.browserCommand;
  requireValue(command && isAbsolute(command.executable) && isAbsolute(command.cwd) && Array.isArray(command.args)
    && command.args.every(item => typeof item === 'string'), '缺少受信浏览器验收命令。');
  const result = spawnSync(command.executable, command.args, { cwd: command.cwd, shell: false, windowsHide: true,
    input: JSON.stringify({ publicOrigin: origin.origin, ...input }), timeout: 300_000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
  requireValue(!result.error && result.status === 0, '真实浏览器验收未完成。');
  const browser = JSON.parse(result.stdout);
  requireValue(browser.pass === true && browser.releaseId === input.releaseId && browser.publicOrigin === origin.origin
    && browser.compile === true && browser.run === true && browser.release === true, '浏览器未确认当前发布的真实编译、运行和释放。');
  const now = Math.floor(Date.now() / 1000);
  return { version: 'maintenance-public-acceptance-v1', sourceRevision: input.sourceRevision, releaseId: input.releaseId,
    batchId: input.batchId, publicOrigin: origin.origin, checkedAt: now, expiresAt: now + 3600, outcome: 'PASSED' };
}
async function main(args) {
  if (!args.length || args[0] === '--help') {
    console.log('部署执行者独立签发公网验收；不应用发布或修改配置。\nnode tools/maintenance/accept-public.mjs --config <私密验收配置> --batch-id <UUID> --release-id <发布号> --source-revision <证据修订> --output <新验收文件>'); return;
  }
  const opts = options(args, ['--config', '--batch-id', '--release-id', '--source-revision', '--output']);
  const path = resolve(opts['--config']), config = readJson(path);
  const payload = await acceptPublic(config, dirname(path), { batchId: opts['--batch-id'], releaseId: opts['--release-id'], sourceRevision: opts['--source-revision'] });
  writeNew(opts['--output'], signReceipt(payload, readFileSync(resolve(dirname(path), config.privateKeyFile))));
  console.log('公网验收已签发。');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(() => {
  console.error('公网验收未完成；未签发通过证明。'); process.exitCode = 1;
});

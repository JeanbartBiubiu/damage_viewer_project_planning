import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameConfiguration } from '../../.agents/skills/damage-api-authoring/scripts/apply-skill-plan.mjs';
import { operationRequests, validateCandidate } from './candidate.mjs';
import { readJson, writeNew, requireValue, options, isUuid, sha256 } from './artifacts.mjs';

export function validateBase(value) {
  const url = new URL(value);
  requireValue(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/'
    && (url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)), '维护来源必须为HTTPS或本机回环地址。');
  return url.origin;
}
export function makeClient(config, configurationDirectory, fetcher = fetch) {
  const base = validateBase(config.apiBase), origin = new URL(config.origin).origin;
  const requestTimeoutMs = config.requestTimeoutMs ?? 60_000;
  requireValue(Number.isSafeInteger(requestTimeoutMs) && requestTimeoutMs >= 1000 && requestTimeoutMs <= 300_000,
    '维护请求超时须为1000～300000整数毫秒。');
  const secret = field => readFileSync(resolve(configurationDirectory, config[field]), 'utf8').trim();
  const session = () => readJson(resolve(configurationDirectory, config.sessionFile));
  async function request(method, path, body, kind = 'session', extraHeaders = {}) {
    requireValue(path.startsWith('/') && !path.includes('?') && !path.includes('#') && !path.includes('\\') && !path.includes('..'), '维护路径不合法。');
    const headers = { Origin: origin, 'X-Damage-Client': 'web', 'Content-Type': 'application/json', ...extraHeaders };
    if (kind === 'long') headers['X-Damage-Maintenance-Token'] = secret('maintenanceTokenFile');
    else if (kind === 'deployment') headers['X-Damage-Deployment-Token'] = secret('deploymentTokenFile');
    else {
      const current = session();
      requireValue(Date.parse(current.expiresAt) > Date.now() && typeof current.cookie === 'string'
        && typeof current.csrf === 'string', '维护会话缺失、失效或格式错误。');
      headers.Cookie = current.cookie;
      if (method !== 'GET') headers['X-CSRF-Token'] = current.csrf;
    }
    let response;
    try { response = await fetcher(`${base}${path}`, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs) }); }
    catch { throw new Error('维护请求未确认；请先查询批次与实际配置，禁止直接重放。'); }
    requireValue(response.ok, `维护接口拒绝，HTTP ${response.status}；未自动重试。`);
    const data = response.status === 204 ? null : await response.json();
    return { data, response };
  }
  const assertRevision = candidate => {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9][0-9]*$/.test(candidate.reference)) return;
    requireValue(config.feedbackQueueDirectory, '问题候选写入前必须配置受信反馈修订目录。');
    const latest = readJson(resolve(configurationDirectory, config.feedbackQueueDirectory, `${sha256(candidate.reference)}-latest.json`));
    requireValue(latest.sourceRevision === candidate.sourceRevision, '问题证据已经变化，旧候选停止提交。');
  };
  return { request, assertRevision };
}
export async function renewBatch(client, batchId, receipt) {
  requireValue(isUuid(batchId), '续签批次编号错误。');
  return (await client.request('POST', `/internal/maintenance/batches/${batchId}/renew`, JSON.stringify(receipt))).data;
}
export async function applyCandidate(client, candidate, outputDirectory) {
  const checked = validateCandidate(candidate), operations = operationRequests(checked);
  if (client.assertRevision) client.assertRevision(checked);
  const state = (await client.request('GET', `/internal/maintenance/batches/${checked.batchId}`)).data;
  requireValue(state.state === 'OPEN' && state.nextOperation === 0 && state.operationCount === operations.length,
    '批次未开放或已有提交，请先独立回读已落地状态；本命令不自动续写。');
  mkdirSync(outputDirectory);
  for (const [index, operation] of operations.entries()) {
    if (client.assertRevision) client.assertRevision(checked);
    const item = checked.skillPlan.items[index], file = resolve(outputDirectory, `${index + 1}`);
    writeNew(`${file}-intent.json`, { batchId: checked.batchId, index, method: operation.method, path: operation.path, bodySha256: sha256(operation.body) });
    const result = await client.request(operation.method, operation.path, operation.body, 'session', { 'X-Damage-Maintenance-Batch': checked.batchId });
    writeNew(`${file}-response.json`, { status: result.response.status });
    const actual = (await client.request('GET', operation.path)).data;
    requireValue(sameConfiguration(actual, item.expected), '独立回读不等于冻结候选；保持维护并停止。');
    const progress = (await client.request('GET', `/internal/maintenance/batches/${checked.batchId}`)).data;
    requireValue(progress.nextOperation === index + 1 && progress.state === 'OPEN', '批次提交事实与回读不符。');
    writeNew(`${file}-readback.json`, { pass: true, actual, progress });
  }
  return { batchId: checked.batchId, applied: operations.length, publicEnabled: false };
}
/** 响应不明后只核对已提交部分，不重新发送任何配置请求。 */
export async function reconcileCandidate(client, candidate, outputDirectory) {
  const checked = validateCandidate(candidate), operations = operationRequests(checked);
  const statePath = `/internal/maintenance/batches/${checked.batchId}`;
  const state = (await client.request('GET', statePath)).data;
  requireValue(state.batchId === checked.batchId && state.gameId === checked.gameId
    && state.operationCount === operations.length && Number.isSafeInteger(state.nextOperation)
    && state.nextOperation >= 0 && state.nextOperation <= operations.length, '批次提交事实与冻结候选不符。');
  mkdirSync(outputDirectory);
  writeNew(resolve(outputDirectory, 'state-before.json'), state);
  for (let index = 0; index < state.nextOperation; index++) {
    const actual = (await client.request('GET', operations[index].path)).data;
    requireValue(sameConfiguration(actual, checked.skillPlan.items[index].expected), '已提交对象的独立回读不等于冻结预期。');
    writeNew(resolve(outputDirectory, `${index + 1}-readback.json`), { confirmedByReadback: true, actual });
  }
  const after = (await client.request('GET', statePath)).data;
  requireValue(after.state === state.state && after.nextOperation === state.nextOperation
    && after.currentDigest === state.currentDigest, '回读期间批次发生变化，请重新核对现场。');
  const baseline = (await client.request('GET', `/internal/maintenance/games/${checked.gameId}/baseline`)).data;
  requireValue(baseline.baselineDigest === state.currentDigest, '实际游戏基线不等于批次最后提交状态。');
  const result = { batchId: checked.batchId, state: state.state, confirmedOperations: state.nextOperation,
    operationCount: operations.length, allOperationsConfirmed: state.nextOperation === operations.length, businessWrites: 0 };
  writeNew(resolve(outputDirectory, 'summary.json'), result);
  return result;
}
async function main(args) {
  const [action, ...rest] = args;
  if (!action || action === '--help') {
    console.log('私有维护客户端（不输出凭据、不自动开维护或恢复公网）\n'
      + 'node tools/maintenance/client.mjs <session|grant|baseline|register|state|open|complete|renew|recover|apply|reconcile|logout> --config <私密配置.json> '
      + '[--game <游戏>] [--batch-id <UUID>] [--recovery-id <新恢复UUID>] [--receipt <新回执文件>] [--batch <批次.json>] [--candidate <候选.json>] [--output <新文件或目录>]');
    return;
  }
  requireValue(['session', 'grant', 'baseline', 'register', 'state', 'open', 'complete', 'renew', 'recover', 'apply', 'reconcile', 'logout'].includes(action), '维护操作未知。');
  const opts = options(rest, ['--config', '--game', '--batch-id', '--recovery-id', '--receipt', '--batch', '--candidate', '--output'], ['--config']);
  const configPath = resolve(opts['--config']), config = readJson(configPath), client = makeClient(config, dirname(configPath));
  const batchId = opts['--batch-id'];
  if (['state', 'open', 'complete', 'renew', 'recover'].includes(action)) requireValue(isUuid(batchId), '需要真实批次编号。');
  let result;
  if (action === 'session') {
    requireValue(opts['--output'], '会话只能写入指定私密文件。');
    const issued = await client.request('POST', '/internal/maintenance/sessions', '{}', 'long');
    const cookies = issued.response.headers.getSetCookie();
    const values = cookies.map(value => value.split(';')[0]);
    const csrf = values.find(value => value.startsWith('__Host-damage-maint-csrf='))?.split('=').slice(1).join('=');
    requireValue(csrf && values.some(value => value.startsWith('__Host-damage-maint-session=')), '未取得完整维护会话。');
    writeNew(opts['--output'], { ...issued.data, cookie: values.join('; '), csrf });
    result = { sessionSaved: true };
  } else if (action === 'grant') {
    requireValue(opts['--output'], '计算票据只能写入指定私密文件。');
    writeNew(opts['--output'], (await client.request('POST', '/internal/maintenance/wasm-grant', '{}')).data);
    result = { grantSaved: true };
  } else if (action === 'baseline') {
    requireValue(/^[a-z0-9_-]{1,64}$/.test(opts['--game'] ?? '') && opts['--output'], '需要游戏及输出文件。');
    result = (await client.request('GET', `/internal/maintenance/games/${opts['--game']}/baseline`)).data;
  } else if (action === 'register') {
    requireValue(opts['--batch'], '需要验证执行者生成的批次文件。');
    result = (await client.request('POST', '/internal/maintenance/batches', JSON.stringify(readJson(opts['--batch'])))).data;
  } else if (action === 'state') result = (await client.request('GET', `/internal/maintenance/batches/${batchId}`)).data;
  else if (action === 'renew') {
    requireValue(opts['--receipt'], '续签必须提供独立验证的新回执。'); result = await renewBatch(client, batchId, readJson(opts['--receipt']));
  } else if (action === 'recover') {
    requireValue(isUuid(opts['--recovery-id']), '恢复需要已验证登记的新批次。');
    result = (await client.request('POST', `/internal/maintenance/batches/${batchId}/recover/${opts['--recovery-id']}`, '{}', 'deployment')).data;
  }
  else if (action === 'open' || action === 'complete') result = (await client.request('POST', `/internal/maintenance/batches/${batchId}/${action}`, '{}', 'deployment')).data;
  else if (action === 'logout') {
    await client.request('POST', '/internal/maintenance/logout', '{}'); result = { loggedOut: true };
  } else {
    requireValue(opts['--candidate'] && opts['--output'], '需要冻结候选与新证据目录。');
    result = await (action === 'reconcile' ? reconcileCandidate : applyCandidate)(client, readJson(opts['--candidate']), resolve(opts['--output']));
  }
  if (opts['--output'] && !['session', 'grant', 'apply', 'reconcile'].includes(action)) writeNew(opts['--output'], result);
  console.log(JSON.stringify(['baseline', 'state', 'apply', 'reconcile', 'logout'].includes(action) ? result : { action, complete: true }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => { console.error('维护操作未完成；保留已有证据并先独立回读，不自动重试。'); process.exitCode = 1; });
}

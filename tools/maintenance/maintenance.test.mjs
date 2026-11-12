import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { resolve, dirname, basename } from 'node:path';
import { validateCandidate, candidateSnapshot, operationRequests, operationsForBatch, stableCandidateDependencies } from './candidate.mjs';
import { sha256, digestJson, canonical, containedFile } from './artifacts.mjs';
import { signReceipt, validationPayload, verifyDatabaseInputs } from './verify-candidate.mjs';
import { makeClient, validateBase, applyCandidate } from './client.mjs';
import { verifyWebhook, feedbackTask, enqueueFeedback, validateResult, processJob, verifyAcceptance, publishReply } from './feedback.mjs';
import { publicRoutes, renderNginx } from './generate-nginx.mjs';

const id = '0f053196-ddbb-4e83-9a77-818c51b21268';
const hash = 'a'.repeat(64);
function fixture() {
  const before = { skill: { gameId: 'lol', skillKey: 'q', name: '原技能', description: null, sortOrder: 0,
    maxLevel: 1, status: 'ENABLED', skillCategoryKeys: [] }, parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [], baseDigest: hash };
  const expected = structuredClone(before); expected.skill.description = '依据已核对的说明';
  const request = { baseDigest: hash, skill: { name: expected.skill.name, description: expected.skill.description, sortOrder: 0,
    maxLevel: 1, status: 'ENABLED', skillCategoryKeys: [] }, changes: [] };
  return { version: 'maintenance-candidate-v1', batchId: id, principalId: id, gameId: 'lol', reference: 'test/feedback#1',
    sourceRevision: 'revision-1', baselineDigest: hash,
    skillPlan: { schemaVersion: 'skill-configuration-plan-v1', gameId: 'lol', items: [{ skillKey: 'q', before, expected, request,
      sourceEvidence: [{ path: 'source.txt', sha256: sha256('source'), note: '已确认文本' }] }] },
    scenes: [{ id: 'normal', snapshot: { gameId: 'lol', selection: { sourceLevel: 1 }, skillConfigurations: [before],
      catalogs: { resistance: 10 }, readAt: '2026-11-13T00:00:00Z' }, scenario: { mode: 'fixed' } }],
    expectedPlan: { cases: [{ id: 'normal', inputs: { attack: 80 }, checks: [{ pointer: '/done/damage', expression: '60 + 0.5 * attack', comparison: 'amount' }] }] } };
}
function temporary(t) {
  const directory = mkdtempSync(resolve(tmpdir(), 'damage-maintenance-test-')), parent = realpathSync(tmpdir());
  t.after(() => { const target = realpathSync(directory); assert.equal(dirname(target), parent); assert.match(basename(target), /^damage-maintenance-test-/); rmSync(target, { recursive: true }); });
  return directory;
}
function issue(body = '实际伤害与预期不同。', updatedAt = '2026-11-13T00:00:00Z') {
  return { action: 'opened', repository: { full_name: 'test/feedback' }, sender: { type: 'User' },
    issue: { number: 1, title: '伤害问题', body, updated_at: updatedAt, html_url: 'https://github.com/test/feedback/issues/1' } };
}

test('冻结候选、原始PATCH字节、运行快照和预期分别保留身份', () => {
  const input = fixture(), copy = structuredClone(input), candidate = validateCandidate(input);
  assert.equal(candidate.candidateDigest, digestJson(input));
  assert.equal(operationRequests(candidate)[0].bodySha256, sha256(JSON.stringify(input.skillPlan.items[0].request)));
  assert.deepEqual(operationsForBatch(candidate)[0], { method: 'PATCH', path: '/api/admin/games/lol/skills/q/configuration', bodySha256: operationRequests(candidate)[0].bodySha256 });
  const snapshot = candidateSnapshot(candidate, candidate.scenes[0]);
  assert.equal(snapshot.skillConfigurations[0].skill.description, '依据已核对的说明');
  assert.notEqual(snapshot.snapshotDigest, candidate.scenes[0].snapshot.snapshotDigest);
  assert.deepEqual(input, copy);
});
test('候选改动、缺少场景或预期、未声明修改均被拒绝', () => {
  const candidate = validateCandidate(fixture()); candidate.scenes[0].snapshot.catalogs.resistance = 0;
  assert.throws(() => validateCandidate(candidate), /摘要/);
  for (const mutate of [value => value.scenes = [], value => value.expectedPlan.cases[0].id = 'other',
    value => value.skillPlan.items[0].expected.skill.maxLevel = 2]) {
    const input = fixture(); mutate(input); assert.throws(() => validateCandidate(input));
  }
});
test('改变来源、引用、排序或结构不能沿用旧依赖闭包签发', () => {
  const before = fixture().skillPlan.items[0].before;
  for (const mutate of [value => value.skill.status = 'DISABLED', value => value.skill.maxLevel = 2,
    value => value.skill.sortOrder = 1, value => value.skill.skillCategoryKeys = ['new'], value => value.triggerRules.push({ ruleKey: 'new' })]) {
    const after = structuredClone(before); mutate(after); assert.equal(stableCandidateDependencies(before, after), false);
  }
  const first = structuredClone(before); first.parameters = [{ fixedValue: 10, valueMode: 'FIXED' }];
  const second = structuredClone(first); second.parameters[0].fixedValue = 20;
  assert.equal(stableCandidateDependencies(first, second), true);
});
test('独立验证重新读取完整真实快照，伪造抗性和读取期间漂移失败', async () => {
  const candidate = validateCandidate(fixture());
  const client = { request: async (method) => ({ data: method === 'GET' ? { baselineDigest: hash } : { ...candidate.scenes[0].snapshot, readAt: 'new' } }) };
  await verifyDatabaseInputs(candidate, client);
  const forged = structuredClone(candidate); forged.scenes[0].snapshot.catalogs.resistance = 0;
  await assert.rejects(verifyDatabaseInputs(forged, client), /真实场景/);
  let reads = 0;
  await assert.rejects(verifyDatabaseInputs(candidate, { request: async method => ({ data: method === 'GET'
    ? { baselineDigest: ++reads > 1 ? 'b'.repeat(64) : hash } : candidate.scenes[0].snapshot }) }), /基线/);
});
test('只在启用第2版验签且全部真实对照通过后构造回执', () => {
  const candidate = validateCandidate(fixture()), summary = { complete: true, requested: 1, completed: 1,
    candidateDigest: candidate.candidateDigest, engineDigest: hash, adapterVersion: 'test', authorizationRequired: true, authorizationVersion: 2 };
  const report = { pass: true, cases: [{}] }, payload = validationPayload(candidate, summary, report, hash, 1000);
  assert.equal(payload.expiresAt, 4600); assert.equal(payload.operationsDigest, digestJson(operationsForBatch(candidate)));
  for (const override of [{ complete: false }, { authorizationRequired: false }, { authorizationVersion: 1 }, { completed: 0 }, { candidateDigest: hash }]) {
    assert.throws(() => validationPayload(candidate, { ...summary, ...override }, report, hash));
  }
  assert.throws(() => validationPayload(candidate, summary, { pass: false, cases: [{}] }, hash));
  const key = generateKeyPairSync('ed25519'), receipt = signReceipt(payload, key.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  assert.equal(verify(null, Buffer.from(receipt.payload, 'base64url'), key.publicKey, Buffer.from(receipt.signature, 'base64url')), true);
  assert.equal(verify(null, Buffer.from(`${receipt.payload}x`, 'base64url'), key.publicKey, Buffer.from(receipt.signature, 'base64url')), false);
});
test('只读入口白名单保留必要POST并拒绝配置写入与内部路由', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../server/data_manage/src/main/resources/api-access.json', import.meta.url)));
  const routes = publicRoutes(catalog);
  assert(routes.some(row => row.method === 'POST' && row.path.endsWith('/simulation-snapshot')));
  assert(routes.some(row => row.path === '/api/auth/wasm-grant'));
  assert(!routes.some(row => row.path.startsWith('/internal/') || row.method === 'PATCH' || row.method === 'DELETE' || row.path.includes('last30days')));
  assert(routes.some(row => row.method === 'HEAD' && row.path === '/api/games'));
  const nginx = renderNginx(catalog); assert.match(nginx.maps, /default 0/); assert.match(nginx.gate, /return 403/);
  assert.throws(() => publicRoutes({ version: 1, routes: [{ method: 'POST', path: '/api/admin/games/{gameId}/skills', access: 'PUBLIC_READ' }] }));
});
test('问题事件必须校验原始字节HMAC和仓库，机器人及拉取请求评论不触发', () => {
  const secret = 'x'.repeat(32), bytes = Buffer.from(JSON.stringify(issue())), signature = `sha256=${createHmac('sha256', secret).update(bytes).digest('hex')}`;
  verifyWebhook(bytes, signature, secret);
  assert.throws(() => verifyWebhook(Buffer.from(`${bytes} `), signature, secret));
  assert.throws(() => feedbackTask('issues', issue(), 'other/repository'));
  assert.equal(feedbackTask('issues', { ...issue(), sender: { type: 'Bot' } }, 'test/feedback'), null);
  const pr = issue(); pr.issue.pull_request = {}; assert.equal(feedbackTask('issue_comment', pr, 'test/feedback'), null);
  const ownReply = { ...issue(), action: 'created', comment: { id: 1, updated_at: '2026-11-13T00:00:00Z',
    body: `已处理\n<!-- damage-maintenance:${hash} -->` } };
  assert.equal(feedbackTask('issue_comment', ownReply, 'test/feedback'), null);
});
test('同修订事件去重，旧事件不覆盖较新证据，未解释的问题不能自报解决', t => {
  const directory = temporary(t), first = feedbackTask('issues', issue(), 'test/feedback');
  const queued = enqueueFeedback(directory, first, 'delivery-1'); assert.equal(queued.duplicate, false);
  assert.equal(enqueueFeedback(directory, first, 'delivery-2').duplicate, true);
  const second = feedbackTask('issues', issue('补充证据', '2026-11-13T00:00:01Z'), 'test/feedback');
  enqueueFeedback(directory, second, 'delivery-3');
  enqueueFeedback(directory, first, 'delivery-4');
  assert.equal(JSON.parse(readFileSync(resolve(directory, `${sha256(first.reference)}-latest.json`))).sourceRevision, second.sourceRevision);
  assert.throws(() => validateResult({ sourceRevision: first.sourceRevision, outcome: 'RESOLVED', explanation: '好了' }, first));
  assert.match(feedbackTask('issues', issue('token=private-value Bearer abc123'), 'test/feedback').issue.body, /已移除/);
});
test('过期问题修订在执行前失败，不调用AI进程', async t => {
  const directory = temporary(t), first = feedbackTask('issues', issue(), 'test/feedback'), queued = enqueueFeedback(directory, first, 'delivery-a');
  enqueueFeedback(directory, feedbackTask('issues', issue('新证据', '2026-11-13T00:01:00Z'), 'test/feedback'), 'delivery-b');
  await assert.rejects(processJob({}, directory, queued.id), /修订|变更/);
});
test('维护来源和档案引用拒绝公网明文、凭据URL与路径逃逸', t => {
  assert.equal(validateBase('https://private.example'), 'https://private.example');
  assert.equal(validateBase('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  for (const url of ['http://private.example', 'https://user:pass@example.com', 'https://example.com/api']) assert.throws(() => validateBase(url));
  const directory = temporary(t); writeFileSync(resolve(directory, 'inside'), 'ok');
  assert.equal(containedFile(directory, 'inside'), realpathSync(resolve(directory, 'inside')));
  assert.throws(() => containedFile(directory, '../elsewhere'));
});
test('维护请求遇到网络错误不自动重试，不在错误中回显凭据', async t => {
  const directory = temporary(t); writeFileSync(resolve(directory, 'session.json'), JSON.stringify({ cookie: 'secret-cookie', csrf: 'secret-csrf', expiresAt: '2099-01-01T00:00:00Z' }));
  let calls = 0;
  const client = makeClient({ apiBase: 'https://private.example', origin: 'https://private.example', sessionFile: 'session.json' }, directory,
    async () => { calls++; throw new Error('secret-cookie'); });
  await assert.rejects(client.request('PATCH', '/api/admin/games/lol/skills/q/configuration', '{}'), error => !error.message.includes('secret-cookie') && /不.*重放|禁止.*重放/.test(error.message));
  assert.equal(calls, 1);
});
test('已有提交的批次不从头重放', async t => {
  const directory = temporary(t); let calls = 0;
  const client = { request: async () => { calls++; return { data: { state: 'OPEN', nextOperation: 1, operationCount: 1 } }; } };
  await assert.rejects(applyCandidate(client, validateCandidate(fixture()), resolve(directory, 'apply')), /已有提交/);
  assert.equal(calls, 1);
});
test('已解决必须有独立验收签名和真实COMPLETE批次，布尔自报无效', async t => {
  const directory = temporary(t), task = feedbackTask('issues', issue(), 'test/feedback');
  const key = generateKeyPairSync('ed25519');
  writeFileSync(resolve(directory, 'public.der'), key.publicKey.export({ format: 'der', type: 'spki' }));
  writeFileSync(resolve(directory, 'session.json'), JSON.stringify({ cookie: 'synthetic-session', csrf: 'synthetic-csrf', expiresAt: '2099-01-01T00:00:00Z' }));
  let state = 'OPEN';
  const server = createServer((request, response) => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ batchId: id, state })));
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  t.after(() => new Promise(res => server.close(res)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(resolve(directory, 'client.json'), JSON.stringify({ apiBase: origin, origin: 'https://maintenance.example', sessionFile: 'session.json' }));
  const config = { acceptancePublicKeyFile: 'public.der', publicOrigin: 'https://public.example', maintenanceConfig: 'client.json' };
  const result = { batchId: id, releaseId: 'test-001' }, now = Math.floor(Date.now() / 1000);
  const payload = { version: 'maintenance-public-acceptance-v1', sourceRevision: task.sourceRevision, releaseId: 'test-001', batchId: id,
    publicOrigin: config.publicOrigin, checkedAt: now, expiresAt: now + 3600, outcome: 'PASSED' };
  const signed = signReceipt(payload, key.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  await assert.rejects(verifyAcceptance(config, directory, task, result, { pass: true, publicBrowser: true, batchState: 'COMPLETE' }));
  await assert.rejects(verifyAcceptance(config, directory, task, result, signed), /尚未完成/);
  state = 'COMPLETE'; await verifyAcceptance(config, directory, task, result, signed);
  const wrong = signReceipt({ ...payload, sourceRevision: 'other' }, key.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  await assert.rejects(verifyAcceptance(config, directory, task, result, wrong), /不属于/);
});
test('反馈回复前重新核对远端修订，变化时不发送评论或关闭请求', async t => {
  const directory = temporary(t), task = feedbackTask('issues', issue(), 'test/feedback'), queued = enqueueFeedback(directory, task, 'delivery-reply');
  const job = resolve(directory, queued.id);
  writeFileSync(resolve(job, 'result.json'), JSON.stringify({ sourceRevision: task.sourceRevision, outcome: 'WAITING_EVIDENCE', explanation: '请补充等级。' }));
  writeFileSync(resolve(job, 'reply.json'), JSON.stringify({ body: '请补充等级。', close: false }));
  writeFileSync(resolve(directory, 'github-token.txt'), 'synthetic-test');
  const methods = [];
  await assert.rejects(publishReply({ githubTokenFile: 'github-token.txt' }, directory, directory, queued.id, async (url, opts) => {
    methods.push(opts.method); return { ok: true, json: async () => ({ ...issue().issue, body: '已补充新证据' }) };
  }), /已经变更/);
  assert.deepEqual(methods, ['GET']);
});
test('旁路reply.close不能把候选或待补证据关闭', async t => {
  for (const outcome of ['CANDIDATE', 'WAITING_EVIDENCE']) {
    const directory = temporary(t), task = feedbackTask('issues', issue(), 'test/feedback'), queued = enqueueFeedback(directory, task, `delivery-${outcome.replaceAll('_', '-')}`);
    const job = resolve(directory, queued.id);
    writeFileSync(resolve(job, 'result.json'), JSON.stringify({ sourceRevision: task.sourceRevision, outcome, explanation: '仍待验证。',
      ...(outcome === 'CANDIDATE' ? { candidateFile: 'candidate.json' } : {}) }));
    writeFileSync(resolve(job, 'reply.json'), JSON.stringify({ body: '旁路关闭', close: true }));
    writeFileSync(resolve(directory, 'github-token.txt'), 'synthetic-test');
    const methods = [];
    await publishReply({ githubTokenFile: 'github-token.txt' }, directory, directory, queued.id, async (url, opts) => {
      methods.push(opts.method);
      return { ok: true, json: async () => opts.method === 'GET' ? issue().issue : { id: 1 } };
    });
    assert.deepEqual(methods, ['GET', 'POST']);
  }
});

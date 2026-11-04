// 隔离密钥只在当前进程内生成，用于两种真实 Wasm 构建及入口验签；不是正式产物签发方。
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign as ed25519Sign, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import {
  compileCanonicalSession, instantiateGenericHost, invokeFrame, moduleRoot,
  releaseCanonicalSession, runCanonicalSession,
} from './generic-abi-host.mjs';
import { createFormulaPhase4Input } from './formula-phase4-input.mjs';

function claims(account = randomUUID(), iat = Math.floor(Date.now() / 1000) - 1) {
  return { iss: 'damage-viewer', aud: 'damage-viewer-wasm', sub: account, canLogin: 1,
    scope: ['engine:compute'], iat, nbf: iat, exp: iat + 300, authorizationVersion: 1, jti: randomUUID() };
}

function authorizedFixture(authorization) {
  const fixture = createFormulaPhase4Input();
  fixture.compileRequest.authorization = authorization;
  fixture.runRequest.authorization = authorization;
  return fixture;
}

function checkIdentity(path, required, keyID, publicKey) {
  const bytes = readFileSync(path);
  const identity = JSON.parse(readFileSync(path.replace(/\.[^.]+$/, '.identity.json'), 'utf8'));
  assert.equal(identity.bytes, bytes.length);
  assert.equal(identity.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(identity.authorizationRequired, required);
  assert.equal(identity.authorizationVersion, 1);
  assert.equal(identity.authorizationKeyId, required ? keyID : null);
  assert.equal(identity.authorizationPublicKey, required ? publicKey : null);
  return { ...identity, gzipBytes: gzipSync(bytes).length };
}

function expectRejected(host, operation, request, code) {
  const name = operation === 'compile' ? 'engine_compile' : 'engine_run';
  assert.throws(() => invokeFrame(host.exports, name, operation === 'compile' ? 200 : 201, request), error => {
    assert.match(error.message, new RegExp(`"code":"${code}"`));
    return true;
  });
}

function entranceMeasurement(host, fixture, count = 25) {
  const compileSamples = [];
  for (let i = 0; i < count + 5; i++) {
    const start = performance.now();
    const compiled = compileCanonicalSession(host.exports, fixture);
    const elapsed = performance.now() - start;
    releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash);
    if (i >= 5) compileSamples.push(elapsed);
  }
  const compiled = compileCanonicalSession(host.exports, fixture);
  const runSamples = [];
  for (let i = 0; i < count + 5; i++) {
    const start = performance.now();
    runCanonicalSession(host.exports, fixture, compiled.sessionId, compiled.rulesHash);
    if (i >= 5) runSamples.push(performance.now() - start);
  }
  releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash);
  const stats = values => ({ meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50Ms: [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)] });
  return { samples: count, compile: stats(compileSamples), run: stats(runSamples),
    scope: 'Node请求编码、真实入口、出箱复制与清理、响应解码；不含签发；不是纯数值循环耗时' };
}

// signGrant 接收未经编码的头与正文字符串，由当前受控签发方返回紧凑票据。
export async function verifyAuthorizationArtifacts({ disabledPath, enabledPath, keyID, publicKey, signGrant }) {
  const disabledIdentity = checkIdentity(disabledPath, false, keyID, publicKey);
  const enabledIdentity = checkIdentity(enabledPath, true, keyID, publicKey);
  const disabled = await instantiateGenericHost(disabledPath);
  const enabled = await instantiateGenericHost(enabledPath);
  const header = { alg: 'Ed25519', typ: 'dv-wasm-grant+jwt', kid: keyID };
  const grant = (payload, tokenHeader = header) => signGrant(JSON.stringify(tokenHeader), JSON.stringify(payload));
  const account = randomUUID();
  const validClaims = claims(account);
  const valid = grant(validClaims);
  const enabledFixture = authorizedFixture(valid);
  const disabledFixture = authorizedFixture('malformed-grant-is-ignored-by-explicitly-disabled-build');

  expectRejected(enabled, 'compile', { ...enabledFixture.compileRequest, authorization: '' }, 'authorization_required');
  expectRejected(enabled, 'compile', { ...enabledFixture.compileRequest, authorization: 'forged' }, 'authorization_invalid');
  expectRejected(enabled, 'compile', { ...enabledFixture.compileRequest, authorization: '', runtimeOptions: { authorizationRequired: false } }, 'authorization_required');
  const compiled = compileCanonicalSession(enabled.exports, enabledFixture);
  const runRequest = { ...enabledFixture.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash };
  const signedNegatives = [
    ['unpaid', { ...validClaims, canLogin: 0 }],
    ['wrong-purpose', { ...validClaims, scope: ['edit'] }],
    ['wrong-audience', { ...validClaims, aud: 'another-service' }],
    ['wrong-version', { ...validClaims, authorizationVersion: 2 }],
    ['long-life', { ...validClaims, exp: validClaims.exp + 1 }],
    ['noninteger-paid', { ...validClaims, canLogin: true }],
    ['future', claims(account, Math.floor(Date.now() / 1000) + 300)],
  ];
  for (const [, payload] of signedNegatives) {
    expectRejected(enabled, 'run', { ...runRequest, authorization: grant(payload) }, 'authorization_invalid');
  }
  expectRejected(enabled, 'run', { ...runRequest, authorization: grant(claims(account, Math.floor(Date.now() / 1000) - 301)) }, 'authorization_expired');
  expectRejected(enabled, 'run', { ...runRequest, authorization: grant(claims()) }, 'authorization_account_mismatch');
  expectRejected(enabled, 'run', { ...runRequest, authorization: grant(validClaims, { ...header, alg: 'EdDSA' }) }, 'authorization_invalid');
  expectRejected(enabled, 'run', { ...runRequest, authorization: grant(validClaims, { ...header, kid: 'unknown-key' }) }, 'authorization_invalid');
  const duplicatePayload = JSON.stringify(validClaims).replace('"canLogin":1', '"canLogin":0,"canLogin":1');
  expectRejected(enabled, 'run', { ...runRequest, authorization: signGrant(JSON.stringify(header), duplicatePayload) }, 'authorization_invalid');
  const duplicateHeader = JSON.stringify(header).replace('"alg":', '"alg":"Ed25519","alg":');
  expectRejected(enabled, 'run', { ...runRequest, authorization: signGrant(duplicateHeader, JSON.stringify(validClaims)) }, 'authorization_invalid');
  const segments = valid.split('.');
  const changedPayload = Buffer.from(JSON.stringify({ ...validClaims, canLogin: 0 })).toString('base64url');
  expectRejected(enabled, 'run', { ...runRequest, authorization: `${segments[0]}.${changedPayload}.${segments[2]}` }, 'authorization_invalid');
  expectRejected(enabled, 'run', { ...runRequest, authorization: 'x'.repeat(4097) }, 'authorization_invalid');
  expectRejected(enabled, 'run', { ...runRequest, authorization: '', authorizationRequired: false }, 'authorization_required');
  expectRejected(enabled, 'run', { ...runRequest, expectedRulesHash: 'wrong-rules' }, 'hash_mismatch');
  const enabledDone = runCanonicalSession(enabled.exports, enabledFixture, compiled.sessionId, compiled.rulesHash);
  const renewed = authorizedFixture(grant({ ...validClaims, jti: randomUUID() }));
  assert.deepEqual(runCanonicalSession(enabled.exports, renewed, compiled.sessionId, compiled.rulesHash), enabledDone);
  // 释放没有 authorization；前一个失败请求已使用过期票据。
  expectRejected(enabled, 'run', { ...runRequest, authorization: grant(claims(account, Math.floor(Date.now() / 1000) - 301)) }, 'authorization_expired');
  releaseCanonicalSession(enabled.exports, compiled.sessionId, compiled.rulesHash);
  expectRejected(enabled, 'run', runRequest, 'session_not_found');

  const disabledCompiled = compileCanonicalSession(disabled.exports, disabledFixture);
  const disabledDone = runCanonicalSession(disabled.exports, disabledFixture, disabledCompiled.sessionId, disabledCompiled.rulesHash);
  assert.deepEqual(disabledDone, enabledDone);
  expectRejected(disabled, 'run', { ...disabledFixture.runRequest, sessionId: disabledCompiled.sessionId, expectedRulesHash: 'wrong-rules' }, 'hash_mismatch');
  const anonymous = createFormulaPhase4Input();
  assert.deepEqual(runCanonicalSession(disabled.exports, anonymous, disabledCompiled.sessionId, disabledCompiled.rulesHash), enabledDone);
  releaseCanonicalSession(disabled.exports, disabledCompiled.sessionId, disabledCompiled.rulesHash);
  return { assertions: '签名、篡改、用途、付费资格、账号、期限、重复键、密钥、开关、释放、身份与数值一致性',
    disabled: { ...disabledIdentity, entrance: entranceMeasurement(disabled, anonymous) },
    enabled: { ...enabledIdentity, entrance: entranceMeasurement(enabled, renewed) } };
}

function buildArtifact(shell, out, env, expectedFailure = false) {
  const tool = shell === 'powershell' ? 'powershell' : process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const args = shell === 'powershell'
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', './scripts/build-wasm.ps1', '-Out', out]
    : ['./scripts/build-wasm.sh'];
  const result = spawnSync(tool, args, { cwd: moduleRoot, env: { ...env, OUT: out }, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (expectedFailure) {
    assert.notEqual(result.status, 0, 'invalid build authorization configuration succeeded');
    assert.equal(existsSync(resolve(moduleRoot, out)), false, 'invalid configuration produced an artifact');
  } else if (result.status !== 0) {
    throw new Error(`build failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const shell = args[0] === '--shell' ? args[1] : process.platform === 'win32' ? 'powershell' : 'bash';
  if (!['powershell', 'bash'].includes(shell) || args.length && (args[0] !== '--shell' || args.length !== 2)) {
    throw new Error('usage: node scripts/authorization-smoke-node.mjs [--shell powershell|bash]');
  }
  const { publicKey: key, privateKey } = generateKeyPairSync('ed25519');
  const publicKey = key.export({ format: 'jwk' }).x;
  const keyID = `isolated-verification-${randomUUID()}`;
  const env = { ...process.env };
  delete env.WASM_AUTH_REQUIRED;
  delete env.WASM_AUTH_KEY_ID;
  delete env.WASM_AUTH_PUBLIC_KEY;
  delete env.WASM_AUTHORIZATION_FILE;
  const directory = `./target/account-authorization/${shell}`;
  const enabledPath = `${directory}/isolated-enabled/tinygo_engine_v2.wasm`;
  const disabledPath = `${directory}/disabled/tinygo_engine_v2.wasm`;
  buildArtifact(shell, `${directory}/invalid-${randomUUID()}.wasm`, env, true);
  buildArtifact(shell, `${directory}/invalid-${randomUUID()}.wasm`, { ...env, WASM_AUTH_REQUIRED: 'TRUE' }, true);
  buildArtifact(shell, disabledPath, { ...env, WASM_AUTH_REQUIRED: 'false' });
  buildArtifact(shell, enabledPath, { ...env, WASM_AUTH_REQUIRED: 'true', WASM_AUTH_KEY_ID: keyID, WASM_AUTH_PUBLIC_KEY: publicKey });
  const result = await verifyAuthorizationArtifacts({
    disabledPath: resolve(moduleRoot, disabledPath), enabledPath: resolve(moduleRoot, enabledPath), keyID, publicKey,
    signGrant: (header, payload) => {
      const message = `${Buffer.from(header).toString('base64url')}.${Buffer.from(payload).toString('base64url')}`;
      return `${message}.${ed25519Sign(null, Buffer.from(message), privateKey).toString('base64url')}`;
    },
  });
  const evidence = JSON.stringify({ shell, isolatedKeyOnly: true, ...result }, null, 2);
  writeFileSync(resolve(moduleRoot, directory, 'result.json'), `${evidence}\n`);
  console.log(evidence);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

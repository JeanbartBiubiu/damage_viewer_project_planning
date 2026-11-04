import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertWasmBuildMatches, assertWasmBuildMetadataMatches, readDeclaredWasmIdentity,
  validateWasmAuthorizationIdentity, wasmAuthorizationBuildEnvironment } from './lib/wasmBuild.mjs';

test('只接受当前重建与声明、分发字节全部一致；失败不修改正式文件', () => {
  const directory = mkdtempSync(join(tmpdir(), 'damage-wasm-build-'));
  const rebuilt = join(directory, 'rebuilt.wasm'), distributed = join(directory, 'distributed.wasm');
  const before = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const declared = { bytes: before.length, sha256: createHash('sha256').update(before).digest('hex') };
  try {
    writeFileSync(distributed, before);
    writeFileSync(rebuilt, before);
    assert.deepEqual(assertWasmBuildMatches(rebuilt, distributed, declared), declared);
    const changed = Buffer.from(before); changed[7] = 1;
    writeFileSync(rebuilt, changed);
    assert.throws(() => assertWasmBuildMatches(rebuilt, distributed, declared), /源码重建Wasm与分发产物不同/);
    assert.deepEqual(readFileSync(distributed), before);
    assert.throws(() => assertWasmBuildMatches(rebuilt, distributed, { ...declared, bytes: 0 }), /声明不一致/);
    rmSync(rebuilt);
    assert.throws(() => assertWasmBuildMatches(rebuilt, distributed, declared), /ENOENT/);
    assert.deepEqual(readFileSync(distributed), before);
  } finally {
    rmSync(rebuilt, { force: true }); rmSync(distributed, { force: true }); rmdirSync(directory);
  }
});

test('重建沿用分发产物的实际授权策略，不能用环境默认值代替', () => {
  const basic = { bytes: 8, sha256: 'a'.repeat(64) };
  const disabled = { ...basic, authorizationRequired: false, authorizationVersion: 1,
    authorizationKeyId: null, authorizationPublicKey: null };
  const enabled = { ...basic, authorizationRequired: true, authorizationVersion: 1,
    authorizationKeyId: 'local-key-1', authorizationPublicKey: Buffer.alloc(32, 1).toString('base64url') };
  assert.equal(validateWasmAuthorizationIdentity(enabled), enabled);
  assert.deepEqual(wasmAuthorizationBuildEnvironment(disabled), { WASM_AUTH_REQUIRED: 'false', WASM_AUTH_KEY_ID: '', WASM_AUTH_PUBLIC_KEY: '' });
  assert.deepEqual(wasmAuthorizationBuildEnvironment(enabled), { WASM_AUTH_REQUIRED: 'true',
    WASM_AUTH_KEY_ID: 'local-key-1', WASM_AUTH_PUBLIC_KEY: enabled.authorizationPublicKey });
  assert.doesNotThrow(() => assertWasmBuildMetadataMatches({ ...enabled }, enabled));
  assert.throws(() => assertWasmBuildMetadataMatches(disabled, enabled), /元信息与分发声明不一致/);
  assert.throws(() => assertWasmBuildMetadataMatches({ ...enabled, authorizationKeyId: 'another-key' }, enabled), /不一致/);
  assert.throws(() => validateWasmAuthorizationIdentity({ ...enabled, authorizationPublicKey: 'not-a-public-key' }), /32字节公钥/);
  assert.throws(() => validateWasmAuthorizationIdentity({ ...disabled, authorizationKeyId: 'unexpected-key' }), /关闭授权/);
  assert.throws(() => validateWasmAuthorizationIdentity({ ...disabled, authorizationRequired: undefined }), /构建元信息/);
});

test('读取声明时要求显式授权策略与匹配密钥元信息', () => {
  const source = `export const WASM_IDENTITY = { bytes: 8, sha256: '${'b'.repeat(64)}',
    authorizationRequired: false, authorizationVersion: 1, authorizationKeyId: null, authorizationPublicKey: null } as const;`;
  assert.equal(readDeclaredWasmIdentity(source).authorizationRequired, false);
  assert.throws(() => readDeclaredWasmIdentity(source.replace('authorizationRequired: false,', '')), /构建元信息/);
  assert.throws(() => readDeclaredWasmIdentity(source.replace('authorizationPublicKey: null', 'authorizationPublicKey: "unexpected"')), /关闭授权/);
});

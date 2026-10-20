import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertWasmBuildMatches } from './lib/wasmBuild.mjs';

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

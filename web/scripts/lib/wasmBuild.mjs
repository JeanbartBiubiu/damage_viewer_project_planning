import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function assertWasmBuildMatches(rebuiltPath, distributedPath, declared) {
  const rebuilt = readFileSync(rebuiltPath);
  const distributed = readFileSync(distributedPath);
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  if (!declared || declared.bytes !== distributed.length || declared.sha256 !== sha256(distributed)) {
    throw new Error('分发Wasm与wasmIdentity声明不一致，拒绝确认构建');
  }
  if (!rebuilt.equals(distributed)) {
    throw new Error(`当前源码重建Wasm与分发产物不同，拒绝使用旧引擎生成证明；重建 ${sha256(rebuilt)}，分发 ${sha256(distributed)}`);
  }
  return { bytes: rebuilt.length, sha256: sha256(rebuilt) };
}

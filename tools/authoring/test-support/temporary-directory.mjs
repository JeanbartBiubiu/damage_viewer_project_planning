import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 只清理本次mkdtemp生成的目录；Windows瞬时占用按系统支持的方式有限重试。
export function removeFixtureDirectory(directory, prefix) {
  const resolved = path.resolve(directory);
  const expected = path.resolve(prefix);
  assert(resolved.length > expected.length && resolved.startsWith(expected)
    && path.dirname(resolved) === path.dirname(expected), '拒绝清理本用例临时目录范围外的路径');
  fs.rmSync(resolved, { recursive: true, maxRetries: 3, retryDelay: 50 });
}

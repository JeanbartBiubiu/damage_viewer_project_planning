import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'generate.mjs');

function run(root, ...args) {
  const result = spawnSync(process.execPath, [script, '--target', 'web', '--root', root, ...args], { encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.signal, null);
  return result;
}

test('生成与只读检查识别漂移并保留目标文件', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'damage-system-enums-'));
  try {
    await mkdir(resolve(root, 'web'));
    await writeFile(resolve(root, 'web/package.json'), '测试模块标识');
    assert.equal(run(root).status, 0);
    assert.equal(run(root, '--check').status, 0);
    const destination = resolve(root, 'web/src/types/skillSystemEnums.generated.ts');
    const changed = (await readFile(destination, 'utf8')) + '// 内容漂移\n';
    await writeFile(destination, changed);
    assert.equal(run(root, '--check').status, 1);
    assert.equal(await readFile(destination, 'utf8'), changed);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('检查保留实际读取错误，不把目录误报为枚举漂移', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'damage-system-enums-read-'));
  try {
    await mkdir(resolve(root, 'web/src/types/skillSystemEnums.generated.ts'), { recursive: true });
    await writeFile(resolve(root, 'web/package.json'), '测试模块标识');
    const result = run(root, '--check');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EISDIR/);
    assert.doesNotMatch(result.stdout, /生成文件与系统枚举清单不一致/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

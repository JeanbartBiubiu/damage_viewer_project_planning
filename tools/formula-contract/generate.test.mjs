import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'generate.mjs');
function run(args) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }); }

for (const [target, marker] of Object.entries({ web: 'web/package.json', backend: 'server/data_manage/pom.xml', wasm: 'wasm/tinygo_engine_v2/go.mod' })) {
  test(target + '生成、检查和实际漂移识别', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'damage-formula-contract-'));
    try {
      await mkdir(dirname(resolve(root, marker)), { recursive: true });
      await writeFile(resolve(root, marker), '测试模块标识');
      const args = ['--target', target, '--root', root];
      const generated = run(args);
      assert.equal(generated.status, 0, generated.stderr);
      const manifest = JSON.parse(generated.stdout);
      assert.ok(manifest.cases >= 75);
      assert.equal(run([...args, '--check']).status, 0);
      const path = resolve(root, manifest.files[0]);
      const content = await readFile(path, 'utf8');
      await writeFile(path, content.replace('禁止手改', '已经漂移'));
      const drift = run([...args, '--check']);
      assert.notEqual(drift.status, 0);
      assert.match(drift.stderr, /生成文件漂移/);
      assert.equal(await readFile(path, 'utf8'), content.replace('禁止手改', '已经漂移'));
      await writeFile(path, content.replaceAll('\n', '\r\n'));
      assert.equal(run([...args, '--check']).status, 0, '等价换行不报漂移');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test('拒绝缺失目标和相对工作树路径', () => {
  assert.notEqual(run(['--root', 'relative']).status, 0);
  assert.notEqual(run(['--target', 'web', '--root', 'relative']).status, 0);
  assert.notEqual(run(['--target', 'invalid', '--root', tmpdir()]).status, 0);
});

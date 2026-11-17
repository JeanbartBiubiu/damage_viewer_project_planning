import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionRegistry } from './session-registry.mjs';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (root, ...args) => execFileSync('git', ['-c', `safe.directory=${root}`, ...args], {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'damage-agent-registry-test-'));
  t.after(() => {
    const target = resolve(directory);
    assert.ok(target.startsWith(`${resolve(tmpdir())}${sep}`)
      && basename(target).startsWith('damage-agent-registry-test-'));
    rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  });
  const root = join(directory, 'main');
  mkdirSync(join(root, 'agents', 'roles'), { recursive: true });
  for (const roleId of ['manager', 'frontend']) {
    writeFileSync(join(root, 'agents', 'roles', `${roleId}.md`), `# ${roleId}\n`);
  }
  writeFileSync(join(root, '.gitignore'), readFileSync(join(sourceRoot, '.gitignore')));
  git(root, '-c', 'init.defaultBranch=master', 'init', '-q');
  git(root, 'add', '.gitignore', 'agents/roles');
  git(root, '-c', 'user.name=Registry Test', '-c', 'user.email=registry-test@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'test fixture');
  return { root, directory };
}

const lookup = (root, environmentId = 'codex-local', roleId = 'manager') => sessionRegistry({
  command: 'resolve', roleId, environmentId,
}, root);

const bind = (root, threadId, expectedGeneration, environmentId = 'codex-local', roleId = 'manager') => sessionRegistry({
  command: 'bind', roleId, environmentId, threadId, hostId: 'local', expectedGeneration,
}, root);

test('缺文件时自动初始化空登记，登记及其本机附属文件均被 Git 忽略', t => {
  const { root } = fixture(t);
  const result = lookup(root);
  assert.equal(result.status, 'needs_session');
  assert.equal(result.generation, 0);
  assert.equal(result.session, null);
  assert.deepEqual(JSON.parse(readFileSync(result.registryPath, 'utf8')), { formatVersion: 1, environments: {} });
  const before = readFileSync(result.registryPath, 'utf8');
  assert.equal(sessionRegistry({ command: 'init' }, root).status, 'existing');
  assert.equal(readFileSync(result.registryPath, 'utf8'), before);
  const ignored = ['agents/.local/sessions.json', 'agents/.local/sessions.json.lock',
    'agents/.local/sessions.json.example.tmp', 'agents/.local/memory/codex-local/manager.md'];
  assert.deepEqual(git(root, 'check-ignore', ...ignored).trim().split(/\r?\n/), ignored);
  assert.equal(git(root, 'status', '--porcelain'), '');
});

test('未知角色、非法环境和缺失绑定代次在创建登记前拒绝', t => {
  const { root } = fixture(t);
  assert.throws(() => lookup(root, 'codex-local', 'unknown'), /角色定义不存在/);
  assert.throws(() => lookup(root, '../other'), /环境只允许/);
  assert.throws(() => lookup(root, 'codex:local'), /环境只允许/);
  assert.throws(() => bind(root, 'thread-1', undefined), /预期代次/);
  assert.equal(existsSync(join(root, 'agents', '.local')), false);
});

test('开发环境隔离，当前会话复用，过期代次不能覆盖或复活旧登记', t => {
  const { root } = fixture(t);
  const first = bind(root, 'thread-a', 0);
  assert.equal(first.generation, 1);
  assert.equal(bind(root, 'thread-a', 1).generation, 1);
  bind(root, 'thread-other-environment', 0, 'other-environment');
  assert.equal(lookup(root).session.threadId, 'thread-a');
  assert.equal(lookup(root, 'other-environment').session.threadId, 'thread-other-environment');
  assert.throws(() => bind(root, 'thread-stale', 0), /当前代次 1/);
  assert.equal(bind(root, 'thread-b', 1).generation, 2);
  assert.equal(bind(root, 'thread-a', 2).generation, 3);
  const before = readFileSync(first.registryPath, 'utf8');
  assert.throws(() => bind(root, 'thread-stale', 1), /当前代次 3/);
  assert.equal(readFileSync(first.registryPath, 'utf8'), before);
  assert.equal(lookup(root, 'other-environment').session.threadId, 'thread-other-environment');
});

test('Windows 角色与环境的大小写别名均被拒绝，不另建同名映射', t => {
  const { root } = fixture(t);
  const { registryPath } = bind(root, 'thread-original', 0);
  const before = readFileSync(registryPath, 'utf8');
  for (const roleId of ['Manager', 'MANAGER']) {
    assert.throws(() => lookup(root, 'codex-local', roleId), /角色只允许小写/);
    assert.throws(() => bind(root, 'thread-alias', 0, 'codex-local', roleId), /角色只允许小写/);
  }
  assert.throws(() => lookup(root, 'Codex-local'), /环境只允许小写/);
  assert.throws(() => bind(root, 'thread-alias', 0, 'CODEX-LOCAL'), /环境只允许小写/);
  assert.equal(readFileSync(registryPath, 'utf8'), before);
});

test('损坏或非法登记明确失败并保留原始字节，不重新初始化覆盖', t => {
  const { root } = fixture(t);
  const { registryPath } = lookup(root);
  for (const content of ['{broken', 'null', '{"formatVersion":2,"environments":{}}',
    '{"formatVersion":1,"environments":{"Codex-local":{}}}',
    '{"formatVersion":1,"environments":{"codex-local":{"Manager":{}}}}',
    '{"formatVersion":1,"environments":{"codex-local":{"manager":{"threadId":"a","hostId":"local","generation":0,"registeredAt":"2026-11-17T00:00:00Z"}}}}']) {
    writeFileSync(registryPath, content);
    assert.throws(() => sessionRegistry({ command: 'init' }, root), /登记/);
    assert.equal(readFileSync(registryPath, 'utf8'), content);
    assert.equal(existsSync(`${registryPath}.lock`), false);
  }
});

test('登记锁被占用时不抢锁、不改变已有会话，释放后可以正常续接', t => {
  const { root } = fixture(t);
  const { registryPath } = bind(root, 'thread-original', 0);
  const before = readFileSync(registryPath, 'utf8');
  writeFileSync(`${registryPath}.lock`, '{"pid":12345}');
  assert.throws(() => bind(root, 'thread-new', 1), /正被占用/);
  assert.equal(readFileSync(registryPath, 'utf8'), before);
  assert.equal(readFileSync(`${registryPath}.lock`, 'utf8'), '{"pid":12345}');
  unlinkSync(`${registryPath}.lock`);
  assert.equal(bind(root, 'thread-new', 1).generation, 2);
});

test('关联工作树共用主检出的登记和笔记路径，不在各自目录复制', t => {
  const { root, directory } = fixture(t);
  const linked = join(directory, 'linked');
  git(root, 'worktree', 'add', '--detach', linked, 'HEAD');
  const primary = bind(root, 'thread-shared', 0);
  const secondary = lookup(linked);
  assert.equal(secondary.registryPath, primary.registryPath);
  assert.equal(secondary.memoryPath, primary.memoryPath);
  assert.equal(secondary.session.threadId, 'thread-shared');
  assert.equal(existsSync(join(linked, 'agents', '.local')), false);
  bind(linked, 'thread-replaced', 1);
  assert.equal(lookup(root).session.threadId, 'thread-replaced');
});

async function concurrentBindings(t, root, roles) {
  const moduleUrl = new URL('./session-registry.mjs', import.meta.url).href;
  const program = `import { sessionRegistry } from ${JSON.stringify(moduleUrl)};
process.stdout.write('ready\\n');
process.stdin.once('data', () => {
  try {
    sessionRegistry({ command: 'bind', roleId: process.argv[2], environmentId: 'codex-local',
      threadId: process.argv[3], hostId: 'local', expectedGeneration: 0 }, process.argv[1]);
  } catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
  process.stdin.destroy();
});`;
  const children = roles.map((roleId, index) => {
    const processHandle = spawn(process.execPath, ['--input-type=module', '-e', program, root, roleId, `thread-${index}`],
      { stdio: ['pipe', 'pipe', 'pipe'], timeout: 8000 });
    t.after(() => { if (processHandle.exitCode === null) processHandle.kill(); });
    let stderr = '';
    processHandle.stderr.on('data', value => { stderr += value; });
    const ready = new Promise((resolveReady, reject) => {
      processHandle.stdout.once('data', () => resolveReady());
      processHandle.once('error', reject);
      processHandle.once('exit', () => reject(new Error('子进程未准备好即退出。')));
    });
    const done = new Promise((resolveDone, reject) => {
      processHandle.once('error', reject);
      processHandle.once('close', code => resolveDone({ code, stderr, roleId, threadId: `thread-${index}` }));
    });
    return { processHandle, ready, done };
  });
  await Promise.all(children.map(child => child.ready));
  for (const child of children) child.processHandle.stdin.write('go\n');
  return Promise.all(children.map(child => child.done));
}

test('同一角色并发首次绑定只有一方成功，另一方不能覆盖', { timeout: 12000 }, async t => {
  const { root } = fixture(t);
  const results = await concurrentBindings(t, root, ['manager', 'manager']);
  const winners = results.filter(result => result.code === 0);
  assert.equal(winners.length, 1);
  assert.equal(lookup(root).session.threadId, winners[0].threadId);
  const rejected = results.find(result => result.code !== 0);
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /正被占用|登记已变化/);
});

test('不同角色并发更新若遇竞争显式拒绝，重读后补做不会丢失另一角色', { timeout: 12000 }, async t => {
  const { root } = fixture(t);
  const results = await concurrentBindings(t, root, ['manager', 'frontend']);
  for (const result of results) {
    if (result.code === 0) continue;
    assert.equal(result.code, 1);
    assert.match(result.stderr, /正被占用/);
    const current = lookup(root, 'codex-local', result.roleId);
    assert.equal(current.status, 'needs_session');
    bind(root, result.threadId, current.generation, 'codex-local', result.roleId);
  }
  assert.equal(lookup(root).session.threadId, 'thread-0');
  assert.equal(lookup(root, 'codex-local', 'frontend').session.threadId, 'thread-1');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { coordinationCommand } from './coordination.mjs';
import { inspectRuntime } from './coordination-runtime.mjs';
import { localPaths, sourceRoot } from './local-store.mjs';
import { listCurrentSessions, sessionRegistry } from './session-registry.mjs';

const environmentId = 'codex-local';
const hooksConfig = JSON.parse(readFileSync(join(sourceRoot, '.codex', 'hooks.json'), 'utf8'));

function fixture(t, copyProduction = false) {
  const temporaryRoot = realpathSync.native(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'damage-coordination-cli-test-'));
  t.after(() => {
    const target = resolve(directory);
    assert.ok(target.startsWith(`${temporaryRoot}${sep}`)
      && basename(target).startsWith('damage-coordination-cli-test-'));
    rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  });
  const root = join(directory, 'main repo');
  mkdirSync(join(root, 'agents', 'roles'), { recursive: true });
  for (const roleId of ['manager', 'frontend', 'backend', 'wasm', 'authoring', 'reviewer']) {
    writeFileSync(join(root, 'agents', 'roles', `${roleId}.md`), `# ${roleId}\n`);
  }
  copyFileSync(join(sourceRoot, 'agents', 'coordination.json'), join(root, 'agents', 'coordination.json'));
  writeFileSync(join(root, '.gitignore'), '/agents/.local/\n');
  if (copyProduction) {
    for (const name of readdirSync(join(sourceRoot, 'agents')).filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))) {
      copyFileSync(join(sourceRoot, 'agents', name), join(root, 'agents', name));
    }
  }
  execFileSync('git', ['-c', 'init.defaultBranch=master', 'init', '-q'], { cwd: root, stdio: 'pipe' });
  return { root, directory };
}

function bind(root, roleId = 'manager') {
  const binding = sessionRegistry({
    command: 'bind', roleId, environmentId, hostId: 'local', expectedGeneration: 0, threadId: `thread-${roleId}`,
  }, root);
  return { environmentId, roleId, threadId: binding.session.threadId, generation: binding.generation };
}

const identityArgs = identity => ['--environment', identity.environmentId, '--thread-id', identity.threadId, '--generation', String(identity.generation)];
const requestArgs = (identity, bodyFile, task = 'cli-review') => [
  'request', 'reviewer', ...identityArgs(identity), '--from', identity.roleId,
  '--task', task, '--authority', '用户已授权本次独立核对', '--subject', '核对命令行证据', '--body-file', bodyFile,
];
const runtimeBytes = root => {
  const path = join(localPaths(root).localDirectory, 'coordination-runtime.json');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};

function bodyFile(root, name = 'review.txt', body = '请只核对约定的测试与证据。') {
  const directory = join(root, 'agents', '.local', 'messages');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, body, 'utf8');
  return path;
}

function jsonOutput(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.ok(output !== null && typeof output === 'object' && !Array.isArray(output));
  return output;
}

function hookCommands(eventName) {
  const commands = (hooksConfig.hooks[eventName] ?? []).flatMap(group => group.hooks ?? [])
    .filter(hook => hook.type === 'command');
  assert.ok(commands.length > 0, `${eventName} 必须登记可执行钩子。`);
  return commands;
}

function runConfiguredHook(command, cwd, payload) {
  return spawnSync(command, {
    cwd, input: JSON.stringify(payload), encoding: 'utf8', shell: true, windowsHide: true, timeout: 10000,
  });
}

test('命令行贯通发布、文件请求、计划、领取及回执，正文只在实际领取时返回', t => {
  const { root } = fixture(t);
  const manager = bind(root);
  const reviewer = bind(root, 'reviewer');
  assert.equal(coordinationCommand(['matrix'], root).roles.length, 6);
  const published = coordinationCommand(['publish', 'manager', ...identityArgs(manager), '--state', 'working',
    '--current', '正在核对命令行', '--needs', '', '--ref', 'agents/README.md'], root);
  assert.equal(published.revision, 1);
  assert.equal(coordinationCommand(['status', 'manager', '--environment', environmentId], root).roles[0].current, '正在核对命令行');
  assert.ok(coordinationCommand(['peers', 'manager', '--environment', environmentId], root).peers.some(peer => peer.roleId === 'reviewer'));
  const text = '合成详细正文，只供目标会话领取。';
  const path = bodyFile(root, 'review.txt', text);
  const requested = coordinationCommand(requestArgs(manager, relative(root, path)), root);
  const plan = coordinationCommand(['tick', '--environment', environmentId], root);
  assert.deepEqual(plan.groups[0].messageIds, [requested.id]);
  assert.equal(JSON.stringify(plan).includes(text), false);
  const claimed = coordinationCommand(['claim', 'reviewer', requested.id, ...identityArgs(reviewer), '--idle-confirmed'], root);
  assert.equal(claimed.messages[0].body, text);
  assert.equal(claimed.target.threadId, reviewer.threadId);
  const sent = coordinationCommand(['settle', '--environment', environmentId, '--token', claimed.dispatchToken,
    '--outcome', 'sent', '--receipt', '实际核对已投递'], root);
  assert.equal(sent.outcome, 'sent');
  const runtime = coordinationCommand(['runtime', '--environment', environmentId], root);
  assert.equal(runtime.messages[0].state, 'sent');
  assert.equal(JSON.stringify(runtime).includes(text), false);
});

test('命令行拒绝未知或越界参数、缺失身份和非法代次，拒绝时不改运行记录', t => {
  const { root } = fixture(t);
  const manager = bind(root);
  const reviewer = bind(root, 'reviewer');
  const path = bodyFile(root);
  const requested = coordinationCommand(requestArgs(manager, path), root);
  const before = runtimeBytes(root);
  const invalid = [
    [], ['unknown'], ['matrix', 'manager'], ['matrix', '--environment', environmentId],
    ['status', 'manager', 'extra', '--environment', environmentId], ['status', '--unknown', 'value'],
    ['status'], ['status', '--environment', 'Codex-local'], ['status', 'other', '--environment', environmentId],
    ['peers', '--environment', environmentId], ['tick', 'manager', '--environment', environmentId],
    ['runtime', '--environment', environmentId, '--current', '多余'],
    ['publish', 'manager', ...identityArgs(manager), '--state', 'idle', '--current', '近况', '--from', 'manager'],
    ['publish', 'manager', '--environment', environmentId, '--generation', '1', '--state', 'idle', '--current', '近况'],
    ['request', 'reviewer', ...identityArgs(manager), '--from', 'manager', '--task', 'next', '--authority', '已授权', '--subject', '摘要'],
    ['request', 'reviewer', 'extra', ...identityArgs(manager), '--body-file', path],
    ['claim', 'reviewer', requested.id, ...identityArgs(reviewer)],
    ['claim', 'reviewer', ...identityArgs(reviewer), '--idle-confirmed'],
    ['claim', 'other', requested.id, ...identityArgs(reviewer), '--idle-confirmed'],
    ['settle', 'reviewer', '--environment', environmentId],
    ['settle', '--environment', environmentId, '--token', 'unknown', '--outcome', 'sent'],
  ];
  for (const generation of ['0', '-1', '01', '1.0', '1e0', '9007199254740992']) {
    invalid.push(['publish', 'manager', '--environment', environmentId, '--thread-id', manager.threadId,
      '--generation', generation, '--state', 'idle', '--current', '近况']);
  }
  for (const argv of invalid) {
    assert.throws(() => coordinationCommand(argv, root), undefined, JSON.stringify(argv));
    assert.equal(runtimeBytes(root), before);
  }
});

test('正文仅可读取主检出消息目录的真实文件，拒绝目录穿越和目录本身', t => {
  const { root } = fixture(t);
  const manager = bind(root);
  const allowed = bodyFile(root);
  const outside = join(root, 'agents', '.local', 'outside.txt');
  writeFileSync(outside, '合成的目录外正文');
  const before = runtimeBytes(root);
  for (const path of [outside, 'agents/.local/messages/../outside.txt', join(root, 'agents', '.local', 'messages')]) {
    assert.throws(() => coordinationCommand(requestArgs(manager, path), root), /消息文件必须在主检出/);
    assert.equal(runtimeBytes(root), before);
  }
  const requested = coordinationCommand(requestArgs(manager, allowed), root);
  assert.equal(requested.created, true);
});

test('正文路径经符号链接或目录联接逃到消息目录外时拒绝', t => {
  const { root, directory } = fixture(t);
  const manager = bind(root);
  bodyFile(root);
  const outside = join(directory, 'external messages');
  mkdirSync(outside);
  writeFileSync(join(outside, 'private.txt'), '合成外部文本，不得转发');
  const link = join(root, 'agents', '.local', 'messages', 'escape');
  symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  const before = runtimeBytes(root);
  assert.throws(() => coordinationCommand(requestArgs(manager, join(link, 'private.txt')), root), /消息文件必须在主检出/);
  assert.equal(runtimeBytes(root), before);
  assert.deepEqual(inspectRuntime(environmentId, root).messages, []);
});

test('消息目录本身为外逃符号链接或联接时，同样不能转发仓库外文件', t => {
  const { root, directory } = fixture(t);
  const manager = bind(root);
  const outside = join(directory, 'external messages');
  mkdirSync(outside);
  writeFileSync(join(outside, 'private.txt'), '合成外部文本，不得转发');
  const link = join(root, 'agents', '.local', 'messages');
  symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  const before = runtimeBytes(root);
  assert.throws(() => coordinationCommand(requestArgs(manager, join(link, 'private.txt')), root),
    /消息|主检出|路径|文件/, '消息目录本身外逃时必须拒绝。');
  assert.equal(runtimeBytes(root), before);
});

test('关联工作树的相对正文参数仍指向主检出共享消息目录', t => {
  const { root, directory } = fixture(t);
  const manager = bind(root);
  bodyFile(root, 'shared.txt', '主检出保存的共享正文。');
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root}`, ...args], { cwd: root, stdio: 'pipe' });
  git('add', '.gitignore', 'agents');
  git('-c', 'user.name=Coordination Test', '-c', 'user.email=coordination@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture');
  const linked = join(directory, 'linked');
  git('worktree', 'add', '--detach', linked, 'HEAD');
  const result = coordinationCommand(requestArgs(manager, 'agents/.local/messages/shared.txt'), linked);
  assert.equal(result.created, true);
  assert.equal(inspectRuntime(environmentId, root).messages[0].id, result.id);
  assert.equal(existsSync(join(linked, 'agents', '.local')), false);
});

test('正文文件超过字节上限或文字上限明确失败，不创建消息', t => {
  const { root } = fixture(t);
  const manager = bind(root);
  const tooManyBytes = bodyFile(root, 'bytes.txt', '界'.repeat(16001));
  const tooManyCharacters = bodyFile(root, 'characters.txt', 'a'.repeat(12001));
  const before = runtimeBytes(root);
  assert.throws(() => coordinationCommand(requestArgs(manager, tooManyBytes), root), /48000 字节/);
  assert.throws(() => coordinationCommand(requestArgs(manager, tooManyCharacters), root), /12000 字符/);
  assert.equal(runtimeBytes(root), before);
});

test('真实 CLI 子进程从子目录执行时只输出一个 JSON 结果，非法参数返回失败', t => {
  const { root } = fixture(t, true);
  bind(root);
  bind(root, 'reviewer');
  const nested = join(root, 'nested', 'working directory');
  mkdirSync(nested, { recursive: true });
  const cli = join(root, 'agents', 'coordination.mjs');
  const before = listCurrentSessions(root);
  const output = jsonOutput(spawnSync(process.execPath, [cli, 'status', '--environment', environmentId], {
    cwd: nested, encoding: 'utf8', windowsHide: true, timeout: 10000,
  }));
  assert.equal(output.environmentId, environmentId);
  assert.equal(output.roles.length, 6);
  const failed = spawnSync(process.execPath, [cli, 'matrix', '--environment', environmentId], {
    cwd: nested, encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.ifError(failed.error);
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, '');
  assert.match(failed.stderr, /角色协作失败/);
  assert.deepEqual(listCurrentSessions(root), before);
});

test('登记的共享钩子命令从子目录定位主检出并接收、返回 JSON', t => {
  const { root } = fixture(t, true);
  const manager = bind(root);
  bind(root, 'reviewer');
  const nested = join(root, 'nested', 'hook directory');
  mkdirSync(nested, { recursive: true });
  const before = listCurrentSessions(root);
  for (const hook_event_name of ['SessionStart', 'UserPromptSubmit', 'PreCompact', 'PostCompact', 'Stop', 'Interrupt']) {
    for (const hook of hookCommands(hook_event_name)) {
      const result = jsonOutput(runConfiguredHook(hook.command, nested, {
        session_id: manager.threadId, hook_event_name, turn_id: 'wrapper-turn', stop_hook_active: true,
      }));
      if (['SessionStart', 'UserPromptSubmit'].includes(hook_event_name)) {
        assert.equal(result.hookSpecificOutput.hookEventName, hook_event_name);
        assert.match(result.hookSpecificOutput.additionalContext, /manager/);
      } else assert.deepEqual(result, {});
    }
  }
  assert.equal(inspectRuntime(environmentId, root).actors.manager.activity, 'idle');
  assert.deepEqual(listCurrentSessions(root), before);
  assert.equal(existsSync(join(nested, 'agents', '.local')), false);
});

test('原生包装入口不回显提示、转录、末条消息，坏 JSON 不输出原输入', t => {
  const { root } = fixture(t, true);
  const manager = bind(root);
  const wrapper = join(root, 'agents', 'coordination-hook.mjs');
  const privatePath = join(root, 'synthetic-transcript.jsonl');
  writeFileSync(privatePath, '合成转录正文'.repeat(1000));
  const before = runtimeBytes(root);
  const result = jsonOutput(spawnSync(process.execPath, [wrapper], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000,
    input: JSON.stringify({ session_id: manager.threadId, hook_event_name: 'SessionStart',
      prompt: '合成提示'.repeat(1000), last_assistant_message: '合成末条回复'.repeat(1000), transcript_path: privatePath }),
  }));
  assert.ok(result.hookSpecificOutput.additionalContext.length <= 512);
  assert.doesNotMatch(JSON.stringify(result), /合成提示|合成转录正文|合成末条回复|synthetic-transcript/);
  assert.equal(runtimeBytes(root), before);
  const failed = spawnSync(process.execPath, [wrapper], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000, input: '{合成坏输入不应回显',
  });
  assert.ifError(failed.error);
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, '');
  assert.match(failed.stderr, /钩子输入必须是 JSON 对象/);
  assert.doesNotMatch(failed.stderr, /合成坏输入不应回显/);
  assert.equal(runtimeBytes(root), before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { environmentBootstrap } from './environment-bootstrap.mjs';
import { sourceRoot } from './local-store.mjs';
import { coordinationCommand } from './coordination.mjs';
import { queuePeriodicCheck, roleTodos, decideTodo } from './coordination-todo.mjs';
import { listCurrentSessions, sessionRegistry } from './session-registry.mjs';
import { pollingState } from './polling-state.mjs';

function fixture(t) {
  const temporaryRoot = realpathSync.native(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'damage-environment-bootstrap-test-'));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(`${temporaryRoot}${sep}`)
      && basename(directory).startsWith('damage-environment-bootstrap-test-'));
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  const root = join(directory, 'main');
  mkdirSync(join(root, 'agents'), { recursive: true });
  writeFileSync(join(root, 'agents', 'coordination.json'), readFileSync(join(sourceRoot, 'agents', 'coordination.json')));
  execFileSync('git', ['-c', 'init.defaultBranch=master', 'init', '-q'], { cwd: root, stdio: 'pipe' });
  return root;
}

const check = (root, environmentId = 'codex-local') => environmentBootstrap({ command: 'check', environmentId }, root);
const begin = (root, overrides = {}) => environmentBootstrap({ command: 'begin-create', environmentId: 'codex-local',
  nativeAbsenceConfirmed: true, expectedAutomationId: null,
  expectedRevision: check(root, overrides.environmentId ?? 'codex-local').revision, ...overrides }, root);
const bind = (root, overrides = {}) => environmentBootstrap({ command: 'bind', environmentId: 'codex-local',
  automationId: 'native-job', targetThreadId: 'thread-dispatcher', expectedAutomationId: null, status: 'ACTIVE',
  expectedRevision: check(root, overrides.environmentId ?? 'codex-local').revision, ...overrides }, root);
const file = root => join(root, 'agents', '.local', 'automation.json');

test('新环境只初始化登记和原生发现计划，不虚构已经建立自动化', t => {
  const root = fixture(t);
  const plan = check(root);
  assert.equal(plan.action, 'discover_native');
  assert.equal(plan.automationId, null);
  assert.equal(plan.status, 'missing');
  assert.equal(plan.revision, 0);
  assert.equal(plan.desiredWakeEveryMinutes, 240);
  assert.equal(plan.schedule, 'FREQ=MINUTELY;INTERVAL=240');
  assert.match(plan.marker, /^damage-role-polling:[0-9a-f]{24}$/);
  assert.equal(JSON.parse(readFileSync(file(root), 'utf8')).formatVersion, 2);
  assert.equal(check(root).marker, plan.marker);
});

test('本地登记丢失但原生有匹配任务时可以直接复用，不申请新建', t => {
  const root = fixture(t);
  const actual = bind(root);
  assert.equal(actual.action, 'verify_existing');
  assert.equal(actual.automationId, 'native-job');
  assert.equal(actual.attemptId, null);
  assert.equal(check(root).targetThreadId, 'thread-dispatcher');
});

test('创建先独占登记操作，重复或未知结果不允许再建', t => {
  const root = fixture(t);
  assert.throws(() => begin(root, { nativeAbsenceConfirmed: false }), /先通过原生工具/);
  const creating = begin(root);
  assert.equal(creating.status, 'creating');
  assert.ok(creating.attemptId);
  assert.throws(() => begin(root), /不能盲目重复创建/);
  environmentBootstrap({ command: 'creation-result', environmentId: 'codex-local', attemptId: creating.attemptId, expectedRevision: creating.revision,
    outcome: 'uncertain', receipt: '请求超时，尚未确认实际任务' }, root);
  assert.equal(check(root).action, 'reconcile_creation');
  assert.throws(() => environmentBootstrap({ command: 'creation-result', environmentId: 'codex-local',
    attemptId: creating.attemptId, expectedRevision: creating.revision, outcome: 'not_created', receipt: '旧观察不能解除未知结果' }, root), /修订号/);
  assert.throws(() => begin(root), /不能盲目重复创建/);
  assert.throws(() => bind(root, { attemptId: 'wrong-attempt' }), /操作编号不符/);
  const ready = bind(root, { attemptId: creating.attemptId });
  assert.equal(ready.status, 'ACTIVE');
});

test('明确未创建后才可重试，重试操作编号不同', t => {
  const root = fixture(t);
  const first = begin(root);
  assert.throws(() => environmentBootstrap({ command: 'creation-result', environmentId: 'codex-local',
    attemptId: first.attemptId, expectedRevision: first.revision, outcome: 'not_created', receipt: '' }, root), /实际核对依据/);
  environmentBootstrap({ command: 'creation-result', environmentId: 'codex-local', attemptId: first.attemptId, expectedRevision: first.revision,
    outcome: 'not_created', receipt: '原生任务列表按标识核对未创建' }, root);
  const second = begin(root);
  assert.notEqual(second.attemptId, first.attemptId);
});

test('用户暂停的任务保留暂停意图，重新建立也不自动启用', t => {
  const root = fixture(t);
  bind(root, { status: 'PAUSED' });
  assert.equal(check(root).desiredStatus, 'PAUSED');
  const creating = begin(root, { expectedAutomationId: 'native-job' });
  assert.equal(creating.desiredStatus, 'PAUSED');
  assert.throws(() => bind(root, { expectedAutomationId: 'native-job', attemptId: creating.attemptId,
    automationId: 'replacement-job', status: 'ACTIVE' }), /保留用户暂停意图/);
  const rebound = bind(root, { expectedAutomationId: 'native-job', attemptId: creating.attemptId,
    automationId: 'replacement-job', status: 'PAUSED' });
  assert.equal(rebound.status, 'PAUSED');
  assert.equal(rebound.desiredStatus, 'PAUSED');
});

test('不同环境独立登记，过期旧值不能覆盖当前绑定', t => {
  const root = fixture(t);
  const primary = bind(root);
  const other = bind(root, { environmentId: 'another-environment', automationId: 'another-job' });
  assert.notEqual(primary.marker, other.marker);
  assert.equal(check(root).automationId, 'native-job');
  assert.equal(check(root, 'another-environment').automationId, 'another-job');
  const before = readFileSync(file(root), 'utf8');
  assert.throws(() => bind(root, { automationId: 'stale-overwrite' }), /不能覆盖/);
  assert.equal(readFileSync(file(root), 'utf8'), before);
});

test('原生编号未变时旧修订也不能覆盖较新暂停，所有初始化写入均需修订号', t => {
  const root = fixture(t);
  const original = bind(root);
  const paused = bind(root, { expectedAutomationId: 'native-job', status: 'PAUSED', expectedRevision: original.revision });
  assert.equal(paused.revision, original.revision + 1);
  const before = readFileSync(file(root), 'utf8');
  assert.throws(() => bind(root, { expectedAutomationId: 'native-job', status: 'ACTIVE', expectedRevision: original.revision }), /修订号/);
  assert.throws(() => begin(root, { expectedAutomationId: 'native-job', expectedRevision: original.revision }), /修订号/);
  assert.throws(() => bind(root, { expectedAutomationId: 'native-job', expectedRevision: undefined }), /修订号/);
  assert.equal(readFileSync(file(root), 'utf8'), before);
  assert.equal(check(root).desiredStatus, 'PAUSED');
});

test('坏登记或旧格式均明确失败保全，不能借初始化清空旧任务', t => {
  const root = fixture(t);
  check(root);
  for (const content of ['{broken', 'null', '{"formatVersion":1,"automationId":"real-old-job"}',
    '{"formatVersion":2,"environments":{"codex-local":{"status":"ACTIVE"}}}']) {
    writeFileSync(file(root), content);
    assert.throws(() => check(root), /登记|条目/);
    assert.equal(readFileSync(file(root), 'utf8'), content);
    assert.equal(existsSync(`${file(root)}.lock`), false);
  }
});

test('登记不属于本检出时拒绝复用，同名环境在其他克隆有不同标识', t => {
  const root = fixture(t);
  const otherRoot = fixture(t);
  const primary = check(root);
  assert.notEqual(check(otherRoot).marker, primary.marker);
  writeFileSync(file(otherRoot), readFileSync(file(root)));
  const before = readFileSync(file(otherRoot), 'utf8');
  assert.throws(() => check(otherRoot), /属于其他检出/);
  assert.equal(readFileSync(file(otherRoot), 'utf8'), before);
});

function registeredRole(root, roleId = 'manager') {
  const directory = join(root, 'agents', 'roles', roleId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'README.md'), `# ${roleId}\n`);
  const value = sessionRegistry({ command: 'bind', environmentId: 'codex-local', roleId,
    hostId: 'local', threadId: `thread-${roleId}`, expectedGeneration: 0 }, root);
  return { environmentId: 'codex-local', roleId, threadId: value.session.threadId, generation: value.generation };
}

const cli = (root, ...args) => coordinationCommand(args, root);
const identityArgs = identity => ['--environment', identity.environmentId, '--thread-id', identity.threadId,
  '--generation', String(identity.generation)];
const observe = (root, cycleId, identity) => cli(root, 'poll-observe', identity.roleId, ...identityArgs(identity),
  '--cycle', cycleId, '--state', 'idle', '--observed-at', new Date(Date.now()).toISOString());
const defer = (root, cycleId, identity) => cli(root, 'poll-defer', identity.roleId, ...identityArgs(identity), '--cycle', cycleId);

test('bootstrap 命令初始化本地文件但不建立假原生任务，严格模式拒绝发送领取', t => {
  const root = fixture(t);
  const ready = cli(root, 'bootstrap', '--environment', 'codex-local');
  assert.equal(ready.automation.action, 'discover_native');
  assert.equal(existsSync(join(root, 'agents', '.local', 'polling.json')), true);
  assert.equal(existsSync(join(root, 'agents', '.local', 'sessions.json')), true);
  assert.throws(() => cli(root, 'poll-claim', 'manager', '--environment', 'codex-local'), /observe_only/);
});

test('初始化命令传递修订号和创建凭据，过期结果不能释放正在核对的创建', t => {
  const root = fixture(t);
  const initial = cli(root, 'bootstrap', '--environment', 'codex-local').automation;
  assert.throws(() => cli(root, 'bootstrap-create', '--environment', 'codex-local', '--expected-id', 'none', '--native-absent'), /expected-revision/);
  const creating = cli(root, 'bootstrap-create', '--environment', 'codex-local', '--expected-id', 'none',
    '--expected-revision', String(initial.revision), '--native-absent');
  assert.throws(() => cli(root, 'bootstrap-result', '--environment', 'codex-local', '--expected-revision', String(initial.revision),
    '--attempt', creating.attemptId, '--outcome', 'not_created', '--receipt', '过期结果'), /修订号/);
  const bound = cli(root, 'bootstrap-bind', '--environment', 'codex-local', '--expected-id', 'none',
    '--expected-revision', String(creating.revision), '--attempt', creating.attemptId, '--automation-id', 'native-job',
    '--target-thread-id', 'thread-dispatcher', '--native-status', 'ACTIVE');
  assert.equal(bound.status, 'ACTIVE');
  assert.equal(bound.revision, creating.revision + 1);
});

test('严格轮询命令贯通观察与本地待办登记，保持会话和唤醒次数不变', t => {
  const root = fixture(t);
  const manager = registeredRole(root);
  registeredRole(root, 'reviewer');
  const registryPath = join(root, 'agents', '.local', 'sessions.json');
  const original = readFileSync(registryPath, 'utf8');
  const cycle = cli(root, 'poll-begin', '--environment', manager.environmentId);
  assert.equal(cycle.candidates[0].roleId, manager.roleId);
  assert.equal(observe(root, cycle.cycleId, manager).eligible, true);
  const result = defer(root, cycle.cycleId, manager);
  assert.equal(result.outcome, 'deferred');
  const todos = roleTodos(manager, root);
  assert.equal(todos.items.length, 1);
  assert.equal(todos.items[0].kind, 'periodic_check');
  const table = cli(root, 'poll-status', '--environment', manager.environmentId);
  assert.equal(table.activeCycle, null);
  assert.equal(table.rows.manager.wakeCount, 0);
  assert.equal(table.lastWakeAt, null);
  assert.equal(table.cursor, 'reviewer');
  assert.equal(table.history[0].outcome, 'deferred');
  assert.equal(readFileSync(registryPath, 'utf8'), original);
  assert.equal(existsSync(join(root, 'agents', '.local', 'coordination-runtime.json')), false);
});

test('多轮复用同一未关闭周期待办，处理后才建立下一条，不产生完成广播', t => {
  const root = fixture(t);
  const manager = registeredRole(root);
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const round = () => {
    const cycle = cli(root, 'poll-begin', '--environment', manager.environmentId);
    observe(root, cycle.cycleId, manager);
    return defer(root, cycle.cycleId, manager);
  };
  const first = round();
  now += 240 * 60000 + 1;
  const repeated = round();
  assert.equal(repeated.id, first.id);
  assert.equal(repeated.created, false);
  assert.equal(roleTodos({ ...manager, includeClosed: true }, root).items.length, 1);
  decideTodo({ ...manager, todoId: first.id, decision: 'done', note: '已自然检查，无新业务' }, root);
  now += 240 * 60000 + 1;
  const next = round();
  assert.notEqual(next.id, first.id);
  assert.equal(roleTodos({ ...manager, includeClosed: true }, root).items.length, 2);
  assert.equal(existsSync(join(root, 'agents', '.local', 'completion-events.json')), false);
});

test('本地待办已落盘但结算中断，可按保存的待办编号结清，不能伪造已唤醒', t => {
  const root = fixture(t);
  const manager = registeredRole(root);
  const cycle = cli(root, 'poll-begin', '--environment', manager.environmentId);
  observe(root, cycle.cycleId, manager);
  const todoId = `poll:${cycle.cycleId}:${manager.roleId}`;
  const claim = pollingState({ command: 'claim-local', ...manager, cycleId: cycle.cycleId, todoId }, listCurrentSessions(root), root);
  queuePeriodicCheck({ ...manager, cycleId: cycle.cycleId, todoId }, root);
  const unresolved = cli(root, 'poll-begin', '--environment', manager.environmentId);
  assert.equal(unresolved.status, 'needs_reconcile');
  assert.equal(unresolved.claim.todoId, todoId);
  assert.throws(() => cli(root, 'poll-settle', '--environment', manager.environmentId, '--cycle', cycle.cycleId,
    '--token', claim.token, '--outcome', 'sent', '--receipt', '不能作为模型发送回执'), /本地|local|deferred/);
  cli(root, 'poll-settle', '--environment', manager.environmentId, '--cycle', cycle.cycleId,
    '--token', claim.token, '--outcome', 'deferred', '--receipt', `已核对本地待办 ${todoId}`);
  assert.equal(roleTodos(manager, root).items.length, 1);
  assert.equal(cli(root, 'poll-status', '--environment', manager.environmentId).rows.manager.wakeCount, 0);
});

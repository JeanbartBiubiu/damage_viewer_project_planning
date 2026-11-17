import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync,
  rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { completeTask, decideTodo, flushCompletions, roleTodos } from './coordination-todo.mjs';
import { coordinationCommand } from './coordination.mjs';
import { inspectRuntime, nativeHook, requestMessage, wakePlan } from './coordination-runtime.mjs';
import { coordinationState } from './coordination-state.mjs';
import { sourceRoot } from './local-store.mjs';
import { listCurrentSessions, sessionRegistry } from './session-registry.mjs';

const environmentId = 'codex-local';
const roleIds = ['manager', 'frontend', 'backend', 'wasm', 'authoring', 'reviewer'];
const frontendRecipients = ['manager', 'backend', 'wasm', 'reviewer'];
const originalConfig = readFileSync(join(sourceRoot, 'agents', 'coordination.json'), 'utf8');

function fixture(t) {
  const temporaryRoot = realpathSync.native(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'damage-coordination-todo-test-'));
  t.after(() => {
    const target = resolve(directory);
    assert.ok(target.startsWith(`${temporaryRoot}${sep}`)
      && basename(target).startsWith('damage-coordination-todo-test-'));
    rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  });
  const root = join(directory, 'main repo');
  for (const roleId of roleIds) {
    const roleDirectory = join(root, 'agents', 'roles', roleId);
    mkdirSync(roleDirectory, { recursive: true });
    writeFileSync(join(roleDirectory, 'README.md'), `# ${roleId}\n`);
  }
  writeFileSync(join(root, 'agents', 'coordination.json'), originalConfig);
  writeFileSync(join(root, '.gitignore'), '/agents/.local/\n/agents/roles/*/.local/\n');
  execFileSync('git', ['-c', 'init.defaultBranch=master', 'init', '-q'], {
    cwd: root, stdio: 'pipe', windowsHide: true,
  });
  return root;
}

function bind(root, roleId = 'frontend', overrides = {}) {
  const env = overrides.environmentId ?? environmentId;
  const binding = sessionRegistry({
    command: 'bind', roleId, environmentId: env, hostId: 'local', expectedGeneration: 0,
    threadId: `thread-${roleId}-${env}`, ...overrides,
  }, root);
  return { environmentId: env, roleId, threadId: binding.session.threadId, generation: binding.generation };
}

const completionInput = (identity, overrides = {}) => ({
  ...identity, taskKey: 'phase-input-check', authority: '用户授权完成本次输入核对阶段',
  summary: '本角色的输入核对阶段已完成，等待相关角色自行判断', refs: ['agents/README.md'], ...overrides,
});
const complete = (root, identity, overrides = {}) => completeTask(completionInput(identity, overrides), root);
const localFile = (root, name) => join(root, 'agents', '.local', name);
const journalPath = root => localFile(root, 'completion-events.json');
const registryPath = root => localFile(root, 'sessions.json');
const runtimePath = root => localFile(root, 'coordination-runtime.json');
const todoPath = (root, roleId, env = environmentId) =>
  join(root, 'agents', 'roles', roleId, '.local', env, 'todo.json');
const bytes = path => existsSync(path) ? readFileSync(path) : null;
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const events = (root, env = environmentId) => json(journalPath(root)).environments[env] ?? [];
const todos = (root, roleId, env = environmentId, includeClosed = false) =>
  roleTodos({ environmentId: env, roleId, includeClosed }, root);
const todoBytes = (root, env = environmentId) => Object.fromEntries(
  roleIds.map(roleId => [roleId, bytes(todoPath(root, roleId, env))]),
);
const acknowledge = (root, identity, todoId, decision = 'no_action', note = '已核对，本角色无需新增工作') =>
  decideTodo({ ...identity, todoId, decision, note }, root);

function lockTodo(root, roleId, env = environmentId) {
  const path = `${todoPath(root, roleId, env)}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'synthetic-held-todo-lock\n', { flag: 'wx' });
  return path;
}

function partialEvent(root, input) {
  assert.throws(() => completeTask(input, root), /完成申报已保存.*通知尚未齐/);
  const event = events(root, input.environmentId).find(item =>
    item.roleId === input.roleId && item.taskKey === input.taskKey);
  assert.ok(event, '分发失败后必须保留已接受的事件。');
  assert.equal(event.notifiedAt, null);
  return event;
}

const identityArgs = identity => ['--environment', identity.environmentId,
  '--thread-id', identity.threadId, '--generation', String(identity.generation)];
const completeArgs = (identity, task = 'cli-phase') => ['complete', identity.roleId, ...identityArgs(identity),
  '--task', task, '--summary', '命令行阶段已完成', '--authority', '用户授权本次命令行阶段',
  '--ref', 'agents/README.md'];

test('完成通知覆盖全部关系为 1 的角色，关系为 0 和来源自己没有待办', t => {
  const root = fixture(t);
  const source = bind(root);
  const result = complete(root, source);
  assert.equal(result.created, true);
  assert.equal(result.status, 'notified');
  assert.deepEqual(result.recipientRoles, frontendRecipients);
  for (const roleId of frontendRecipients) {
    const resultTodos = todos(root, roleId);
    assert.equal(resultTodos.unread, 1);
    assert.equal(resultTodos.items.length, 1);
    assert.equal(resultTodos.items[0].eventId, result.eventId);
    assert.equal(resultTodos.items[0].fromRoleId, 'frontend');
    assert.equal(resultTodos.items[0].attention, 'check');
    assert.equal(resultTodos.items[0].summary, completionInput(source).summary);
    assert.deepEqual(resultTodos.items[0].refs, ['agents/README.md']);
  }
  for (const roleId of ['frontend', 'authoring']) assert.equal(existsSync(todoPath(root, roleId)), false);
});

test('目标均未启动也只落待办，完成和检查计划不增加会话或运行消息', t => {
  const root = fixture(t);
  const source = bind(root, 'manager');
  const registryBefore = bytes(registryPath(root));
  const runtimeBefore = bytes(runtimePath(root));
  const result = complete(root, source);
  assert.deepEqual(result.recipientRoles, ['frontend', 'backend', 'wasm', 'authoring', 'reviewer']);
  for (const roleId of result.recipientRoles) assert.equal(todos(root, roleId).unread, 1);
  assert.equal(listCurrentSessions(root).length, 1);
  assert.deepEqual(flushCompletions(environmentId, root), { environmentId, delivered: 0, pending: 0 });
  const plan = wakePlan(environmentId, root);
  assert.equal(plan.noAction, true);
  assert.deepEqual(plan.groups, []);
  assert.deepEqual(plan.unresolved, []);
  assert.deepEqual(bytes(registryPath(root)), registryBefore);
  assert.deepEqual(bytes(runtimePath(root)), runtimeBefore);
});

test('目标已运行时仍只追加待办，运行角色、消息及会话登记的原字节不变', t => {
  const root = fixture(t);
  const source = bind(root, 'manager');
  const target = bind(root, 'frontend');
  nativeHook({ session_id: target.threadId, hook_event_name: 'UserPromptSubmit', turn_id: 'busy-turn' }, root);
  assert.equal(inspectRuntime(environmentId, root).actors.frontend.activity, 'running');
  const runtimeBefore = bytes(runtimePath(root));
  const registryBefore = bytes(registryPath(root));
  complete(root, source);
  flushCompletions(environmentId, root);
  assert.equal(todos(root, 'frontend').unread, 1);
  assert.deepEqual(bytes(runtimePath(root)), runtimeBefore);
  assert.deepEqual(bytes(registryPath(root)), registryBefore);
  const runtime = inspectRuntime(environmentId, root);
  assert.equal(runtime.actors.frontend.activity, 'running');
  assert.equal(runtime.actors.frontend.activeTurnId, 'busy-turn');
  assert.deepEqual(runtime.messages, []);
});

test('重复完成幂等，引用分隔符与关注角色顺序的等价输入不重复写待办', t => {
  const root = fixture(t);
  const source = bind(root, 'manager');
  const first = complete(root, source, { refs: ['agents\\README.md'], attentionRoles: ['backend', 'frontend'] });
  const journalBefore = bytes(journalPath(root));
  const todosBefore = todoBytes(root);
  const repeated = complete(root, source, { attentionRoles: ['frontend', 'backend'] });
  assert.equal(repeated.created, false);
  assert.equal(repeated.eventId, first.eventId);
  assert.equal(events(root).length, 1);
  assert.deepEqual(bytes(journalPath(root)), journalBefore);
  assert.deepEqual(todoBytes(root), todosBefore);
});

test('相同环境来源及任务阶段的摘要、授权、引用或关注变化均拒绝覆盖', t => {
  const root = fixture(t);
  const source = bind(root);
  complete(root, source);
  const journalBefore = bytes(journalPath(root));
  const todosBefore = todoBytes(root);
  for (const change of [
    { summary: '另一份完成摘要' }, { authority: '另一个授权范围' },
    { refs: ['web/README.md'] }, { attentionRoles: ['backend'] },
  ]) {
    assert.throws(() => complete(root, source, change), /内容不同/);
    assert.deepEqual(bytes(journalPath(root)), journalBefore);
    assert.deepEqual(todoBytes(root), todosBefore);
  }
});

test('来源换代后以当前身份重报同一阶段仍复用原事件及原始来源身份', t => {
  const root = fixture(t);
  const old = bind(root, 'backend');
  const first = complete(root, old);
  const current = bind(root, 'backend', { threadId: 'backend-replacement', expectedGeneration: old.generation });
  const journalBefore = bytes(journalPath(root));
  const todosBefore = todoBytes(root);
  const repeated = complete(root, current);
  assert.equal(repeated.eventId, first.eventId);
  assert.equal(repeated.created, false);
  assert.equal(events(root).length, 1);
  assert.equal(events(root)[0].sourceThreadId, old.threadId);
  assert.equal(events(root)[0].sourceGeneration, old.generation);
  assert.deepEqual(bytes(journalPath(root)), journalBefore);
  assert.deepEqual(todoBytes(root), todosBefore);
});

test('旧来源会话和旧代次既不能创建新阶段，也不能借重复申报绕过身份检查', t => {
  const root = fixture(t);
  const old = bind(root);
  complete(root, old);
  const current = bind(root, 'frontend', { threadId: 'frontend-replacement', expectedGeneration: old.generation });
  const journalBefore = bytes(journalPath(root));
  const todosBefore = todoBytes(root);
  for (const identity of [old, { ...current, generation: old.generation },
    { ...current, threadId: old.threadId }, { ...current, roleId: 'authoring' }]) {
    for (const taskKey of ['phase-input-check', 'phase-new']) {
      assert.throws(() => complete(root, identity, { taskKey }), /会话或登记代次已变化/);
      assert.deepEqual(bytes(journalPath(root)), journalBefore);
      assert.deepEqual(todoBytes(root), todosBefore);
    }
  }
});

test('待办处置要求接收角色的当前会话及代次，过期确认不改变原待办', t => {
  const root = fixture(t);
  const source = bind(root, 'manager');
  const old = bind(root, 'frontend');
  complete(root, source);
  const item = todos(root, 'frontend').items[0];
  const current = bind(root, 'frontend', { threadId: 'frontend-new', expectedGeneration: old.generation });
  const before = bytes(todoPath(root, 'frontend'));
  for (const identity of [old, { ...current, generation: old.generation }, { ...current, threadId: old.threadId }]) {
    assert.throws(() => acknowledge(root, identity, item.id), /会话或登记代次已变化/);
    assert.deepEqual(bytes(todoPath(root, 'frontend')), before);
  }
  assert.throws(() => acknowledge(root, source, item.id), /待办不存在/);
  assert.deepEqual(bytes(todoPath(root, 'frontend')), before);
  const result = acknowledge(root, current, item.id, 'done', '已在原授权阶段内核对完毕');
  assert.equal(result.state, 'closed');
  assert.equal(result.decision.threadId, current.threadId);
  assert.equal(result.decision.generation, current.generation);
});

test('不同环境同来源同阶段独立去重，查询和处置不能影响另一环境', t => {
  const root = fixture(t);
  const sourceA = bind(root, 'manager');
  const sourceB = bind(root, 'manager', { environmentId: 'other-local' });
  const targetA = bind(root, 'frontend');
  const targetB = bind(root, 'frontend', { environmentId: 'other-local' });
  const first = complete(root, sourceA);
  assert.equal(existsSync(todoPath(root, 'frontend', 'other-local')), false);
  const second = complete(root, sourceB, { summary: '另一环境独立完成阶段' });
  assert.notEqual(first.eventId, second.eventId);
  assert.equal(events(root).length, 1);
  assert.equal(events(root, 'other-local').length, 1);
  const itemA = todos(root, 'frontend').items[0];
  const itemB = todos(root, 'frontend', 'other-local').items[0];
  assert.equal(itemA.eventId, first.eventId);
  assert.equal(itemB.eventId, second.eventId);
  const beforeB = bytes(todoPath(root, 'frontend', 'other-local'));
  assert.throws(() => acknowledge(root, targetB, itemA.id), /待办不存在/);
  acknowledge(root, targetA, itemA.id);
  assert.deepEqual(bytes(todoPath(root, 'frontend', 'other-local')), beforeB);
  assert.equal(todos(root, 'frontend').items.length, 0);
  assert.equal(todos(root, 'frontend', 'other-local').unread, 1);
});

test('关注建议只改变相关目标的关注程度，不缩减全量关联通知或自动创建后续任务', t => {
  const root = fixture(t);
  const source = bind(root);
  const result = complete(root, source, { attentionRoles: ['reviewer', 'backend'] });
  assert.deepEqual(result.recipientRoles, frontendRecipients);
  for (const roleId of frontendRecipients) {
    assert.equal(todos(root, roleId).items[0].attention,
      ['reviewer', 'backend'].includes(roleId) ? 'requested' : 'check');
  }
  assert.equal(events(root).length, 1);
  assert.equal(bytes(runtimePath(root)), null);
  assert.equal(listCurrentSessions(root).length, 1);
});

test('给自己、无交集角色、未知角色或重复角色的关注建议在接受事件前失败', t => {
  const root = fixture(t);
  const source = bind(root);
  const before = bytes(registryPath(root));
  for (const attentionRoles of [['frontend'], ['authoring'], ['unknown'], ['backend', 'backend'], 'backend']) {
    assert.throws(() => complete(root, source, { attentionRoles }), /关注/);
    assert.equal(bytes(journalPath(root)), null);
    assert.deepEqual(todoBytes(root), Object.fromEntries(roleIds.map(roleId => [roleId, null])));
    assert.deepEqual(bytes(registryPath(root)), before);
  }
});

test('同任务的不同角色各自申报阶段完成，申报不替代已发布近况或总体验收', t => {
  const root = fixture(t);
  const frontend = bind(root);
  const backend = bind(root, 'backend');
  for (const identity of [frontend, backend]) coordinationState({
    command: 'publish', ...identity, state: 'working', current: '完成本角色阶段后仍等待总体核对',
    needs: '等待独立验收', refs: ['agents/README.md'],
  }, root);
  const before = bytes(localFile(root, 'coordination-status.json'));
  const first = complete(root, frontend);
  const second = complete(root, backend);
  assert.notEqual(first.eventId, second.eventId);
  assert.deepEqual(events(root).map(event => event.roleId), ['frontend', 'backend']);
  assert.deepEqual(bytes(localFile(root, 'coordination-status.json')), before);
  assert.equal(coordinationState({ command: 'status', environmentId, roleId: 'frontend' }, root).roles[0].state, 'working');
});

test('完成申报至少需要一条合法证据及明确阶段、摘要和原授权，拒绝时不留事件', t => {
  const root = fixture(t);
  const source = bind(root);
  for (const fields of [
    { refs: [] }, { refs: undefined }, { refs: null }, { refs: ['../external.md'] },
    { refs: ['C:\\private.md'] }, { refs: ['a', 'b', 'c', 'd'] },
    { taskKey: '' }, { summary: ' ' }, { authority: '' },
  ]) {
    assert.throws(() => complete(root, source, fields), /引用|证据|阶段|摘要|授权/);
    assert.equal(bytes(journalPath(root)), null);
    for (const roleId of roleIds) assert.equal(existsSync(todoPath(root, roleId)), false);
  }
});

test('先持会话登记锁再接受完成事件，锁竞争时不创建事件且不抢占原锁', t => {
  const root = fixture(t);
  const source = bind(root);
  const sessionLock = `${registryPath(root)}.lock`;
  const journalLock = `${journalPath(root)}.lock`;
  writeFileSync(sessionLock, 'synthetic-session-lock');
  writeFileSync(journalLock, 'synthetic-journal-lock');
  const before = bytes(registryPath(root));
  assert.throws(() => complete(root, source), /sessions\.json\.lock/);
  assert.equal(readFileSync(sessionLock, 'utf8'), 'synthetic-session-lock');
  assert.equal(readFileSync(journalLock, 'utf8'), 'synthetic-journal-lock');
  assert.equal(bytes(journalPath(root)), null);
  unlinkSync(sessionLock);
  assert.throws(() => complete(root, source), /completion-events\.json\.lock/);
  assert.equal(existsSync(sessionLock), false);
  assert.deepEqual(bytes(registryPath(root)), before);
  assert.equal(bytes(journalPath(root)), null);
  unlinkSync(journalLock);
});

test('损坏或结构不符的完成登记让申报及补偿失败，原字节与已有待办均保留', t => {
  const root = fixture(t);
  const source = bind(root);
  complete(root, source);
  const valid = json(journalPath(root));
  const duplicate = structuredClone(valid);
  duplicate.environments[environmentId].push(structuredClone(duplicate.environments[environmentId][0]));
  const inconsistent = structuredClone(valid);
  inconsistent.environments[environmentId][0].notifiedAt = null;
  const todosBefore = todoBytes(root);
  for (const content of ['{broken', 'null', '[]', '{"formatVersion":2,"environments":{}}',
    JSON.stringify(duplicate), JSON.stringify(inconsistent)]) {
    writeFileSync(journalPath(root), content);
    for (const operation of [() => complete(root, source, { taskKey: 'new-phase' }),
      () => flushCompletions(environmentId, root)]) {
      assert.throws(operation, /JSON|登记|事件|分发进度|阶段重复/);
      assert.equal(readFileSync(journalPath(root), 'utf8'), content);
      assert.deepEqual(todoBytes(root), todosBefore);
      assert.equal(existsSync(`${journalPath(root)}.lock`), false);
      assert.equal(existsSync(`${registryPath(root)}.lock`), false);
    }
  }
});

test('坏待办不能被查询、确认或新通知覆盖，修复文件后原部分事件可全部补齐', t => {
  const root = fixture(t);
  const source = bind(root, 'manager');
  const target = bind(root, 'frontend');
  complete(root, source);
  const path = todoPath(root, 'frontend');
  const originalBytes = bytes(path);
  const valid = json(path);
  const wrongEnvironment = { ...valid, environmentId: 'other-local' };
  const missingDecision = { ...valid, items: valid.items.map(item => ({ ...item, state: 'closed', decision: null })) };
  const cases = ['{broken', 'null', JSON.stringify(wrongEnvironment), JSON.stringify(missingDecision)];
  for (const [index, content] of cases.entries()) {
    writeFileSync(path, content);
    for (const operation of [() => todos(root, 'frontend'),
      () => acknowledge(root, target, valid.items[0].id)]) {
      assert.throws(operation, /JSON|待办|结构/);
      assert.equal(readFileSync(path, 'utf8'), content);
    }
    const before = todoBytes(root);
    partialEvent(root, completionInput(source, { taskKey: `corrupt-target-${index}` }));
    assert.deepEqual(todoBytes(root), before);
    assert.equal(existsSync(`${path}.lock`), false);
    assert.equal(existsSync(`${registryPath(root)}.lock`), false);
    writeFileSync(path, originalBytes);
  }
  const result = flushCompletions(environmentId, root);
  assert.equal(result.pending, 0);
  assert.equal(result.delivered, cases.length * 5);
  assert.equal(todos(root, 'frontend').items.length, cases.length + 1);
  assert.equal(events(root).every(event => event.notifiedAt !== null), true);
});

test('后续目标锁被占用时保留先前落盘的待办，补偿只写尚缺目标', t => {
  const root = fixture(t);
  const source = bind(root);
  const lock = lockTodo(root, 'backend');
  const registryBefore = bytes(registryPath(root));
  const event = partialEvent(root, completionInput(source));
  assert.deepEqual(event.recipients.filter(item => item.delivered).map(item => item.roleId), ['manager']);
  assert.equal(todos(root, 'manager').items[0].eventId, event.id);
  const before = bytes(todoPath(root, 'manager'));
  for (const roleId of ['backend', 'wasm', 'reviewer']) assert.equal(existsSync(todoPath(root, roleId)), false);
  assert.equal(readFileSync(lock, 'utf8'), 'synthetic-held-todo-lock\n');
  assert.deepEqual(bytes(registryPath(root)), registryBefore);
  const journalBefore = bytes(journalPath(root));
  assert.throws(() => flushCompletions(environmentId, root), /正被占用/);
  assert.deepEqual(bytes(journalPath(root)), journalBefore);
  assert.deepEqual(bytes(todoPath(root, 'manager')), before);
  unlinkSync(lock);
  assert.deepEqual(flushCompletions(environmentId, root), { environmentId, delivered: 3, pending: 0 });
  assert.deepEqual(bytes(todoPath(root, 'manager')), before);
  for (const roleId of frontendRecipients) assert.equal(todos(root, roleId).items.length, 1);
  assert.deepEqual(flushCompletions(environmentId, root), { environmentId, delivered: 0, pending: 0 });
});

test('目标待办路径被目录占用时保留部分结果和故障目录，解除后可补偿', t => {
  const root = fixture(t);
  const source = bind(root);
  const path = todoPath(root, 'backend');
  mkdirSync(path, { recursive: true });
  const event = partialEvent(root, completionInput(source));
  assert.equal(statSync(path).isDirectory(), true);
  assert.equal(existsSync(`${path}.lock`), false);
  assert.equal(todos(root, 'manager').items[0].eventId, event.id);
  const before = bytes(todoPath(root, 'manager'));
  rmdirSync(path);
  assert.equal(flushCompletions(environmentId, root).pending, 0);
  assert.equal(todos(root, 'backend').items[0].eventId, event.id);
  assert.deepEqual(bytes(todoPath(root, 'manager')), before);
});

test('部分分发后修改矩阵再重报，仍向原目标快照补齐而不新增目标', t => {
  const root = fixture(t);
  const source = bind(root);
  const lock = lockTodo(root, 'backend');
  const event = partialEvent(root, completionInput(source, { attentionRoles: ['backend'] }));
  const config = JSON.parse(originalConfig);
  config.relations.frontend.backend = config.relations.backend.frontend = 0;
  config.relations.frontend.authoring = config.relations.authoring.frontend = 1;
  writeFileSync(join(root, 'agents', 'coordination.json'), JSON.stringify(config));
  unlinkSync(lock);
  const result = complete(root, source, { attentionRoles: ['backend'] });
  assert.equal(result.created, false);
  assert.equal(result.eventId, event.id);
  assert.deepEqual(result.recipientRoles, frontendRecipients);
  assert.equal(todos(root, 'backend').items[0].attention, 'requested');
  assert.equal(existsSync(todoPath(root, 'authoring')), false);
  assert.deepEqual(events(root)[0].recipients.map(item => item.roleId), frontendRecipients);
  assert.equal(events(root).length, 1);
});

test('待办已处置而分发标记需重放时，不覆盖结论、不重开待办或重复添加条目', t => {
  const root = fixture(t);
  const source = bind(root);
  const target = bind(root, 'manager');
  complete(root, source);
  const item = todos(root, 'manager').items[0];
  acknowledge(root, target, item.id, 'no_action', '本次阶段结果无需本角色行动');
  const before = bytes(todoPath(root, 'manager'));
  // 模拟待办已写入、分发标记尚未提交的崩溃恢复点。
  const checkpoint = json(journalPath(root));
  checkpoint.environments[environmentId][0].recipients.find(recipient => recipient.roleId === 'manager').delivered = false;
  checkpoint.environments[environmentId][0].notifiedAt = null;
  writeFileSync(journalPath(root), JSON.stringify(checkpoint));
  assert.deepEqual(flushCompletions(environmentId, root), { environmentId, delivered: 1, pending: 0 });
  assert.deepEqual(bytes(todoPath(root, 'manager')), before);
  assert.equal(todos(root, 'manager').items.length, 0);
  const all = todos(root, 'manager', environmentId, true);
  assert.equal(all.items.length, 1);
  assert.equal(all.items[0].state, 'closed');
  assert.equal(all.items[0].decision.kind, 'no_action');
  complete(root, source);
  assert.deepEqual(bytes(todoPath(root, 'manager')), before);
});

test('来源会话在部分分发后换代，补偿仍恢复已接受的原事件且不改当前登记', t => {
  const root = fixture(t);
  const old = bind(root);
  const lock = lockTodo(root, 'backend');
  const event = partialEvent(root, completionInput(old));
  const current = bind(root, 'frontend', { threadId: 'frontend-next', expectedGeneration: old.generation });
  const registryBefore = bytes(registryPath(root));
  unlinkSync(lock);
  assert.deepEqual(flushCompletions(environmentId, root), { environmentId, delivered: 3, pending: 0 });
  assert.equal(events(root)[0].sourceThreadId, old.threadId);
  assert.equal(events(root)[0].sourceGeneration, old.generation);
  assert.equal(events(root)[0].id, event.id);
  assert.deepEqual(bytes(registryPath(root)), registryBefore);
  assert.equal(complete(root, current).created, false);
  for (const roleId of frontendRecipients) assert.equal(todos(root, roleId).items.length, 1);
});

test('查询和接收者的三种处置不会授权新工作或连锁生成完成事件及发送计划', t => {
  const root = fixture(t);
  const source = bind(root, 'manager');
  const targets = ['frontend', 'backend', 'wasm'].map(roleId => bind(root, roleId));
  complete(root, source);
  const journalBefore = bytes(journalPath(root));
  const runtimeBefore = bytes(runtimePath(root));
  const registryBefore = bytes(registryPath(root));
  for (const [index, decision] of ['follow_up', 'no_action', 'done'].entries()) {
    const target = targets[index];
    const item = todos(root, target.roleId).items[0];
    const result = acknowledge(root, target, item.id, decision, '只记录接收者的判断，仍受原授权约束');
    assert.equal(result.state, decision === 'follow_up' ? 'follow_up' : 'closed');
    assert.equal(todos(root, target.roleId).unread, 0);
    assert.equal(todos(root, target.roleId).items.length, decision === 'follow_up' ? 1 : 0);
    const before = bytes(todoPath(root, target.roleId));
    acknowledge(root, target, item.id, decision, '只记录接收者的判断，仍受原授权约束');
    assert.deepEqual(bytes(todoPath(root, target.roleId)), before);
  }
  const frontendItem = todos(root, 'frontend').items[0];
  acknowledge(root, targets[0], frontendItem.id, 'done', '原授权内的跟进已完成');
  const closed = bytes(todoPath(root, 'frontend'));
  assert.throws(() => acknowledge(root, targets[0], frontendItem.id, 'follow_up'), /已关闭待办/);
  assert.deepEqual(bytes(todoPath(root, 'frontend')), closed);
  const context = nativeHook({ session_id: targets[0].threadId, hook_event_name: 'SessionStart' }, root);
  assert.match(context.hookSpecificOutput.additionalContext, /待办/);
  const plan = wakePlan(environmentId, root);
  assert.equal(plan.noAction, true);
  assert.deepEqual(plan.groups, []);
  assert.deepEqual(bytes(journalPath(root)), journalBefore);
  assert.deepEqual(bytes(runtimePath(root)), runtimeBefore);
  assert.deepEqual(bytes(registryPath(root)), registryBefore);
  assert.equal(events(root).length, 1);
});

test('CLI complete 的多条证据和关注建议贯通 todo、当前身份确认及已关闭查询', t => {
  const root = fixture(t);
  const source = bind(root, 'manager');
  const target = bind(root, 'frontend');
  const args = [...completeArgs(source), '--ref', 'agents\\roles\\manager\\README.md',
    '--attention', 'frontend', '--attention', 'backend'];
  const result = coordinationCommand(args, root);
  assert.equal(result.created, true);
  assert.equal(result.status, 'notified');
  const listed = coordinationCommand(['todo', 'frontend', '--environment', environmentId], root);
  assert.equal(listed.todoPath, todoPath(root, 'frontend'));
  assert.equal(listed.unread, 1);
  assert.equal(listed.items[0].attention, 'requested');
  assert.deepEqual(listed.items[0].refs, ['agents/README.md', 'agents/roles/manager/README.md']);
  assert.equal(todos(root, 'backend').items[0].attention, 'requested');
  assert.equal(todos(root, 'wasm').items[0].attention, 'check');
  const acknowledged = coordinationCommand(['todo-ack', 'frontend', listed.items[0].id, ...identityArgs(target),
    '--decision', 'no_action', '--note', '已核对，本角色无需追加工作'], root);
  assert.equal(acknowledged.state, 'closed');
  assert.equal(coordinationCommand(['todo', 'frontend', '--environment', environmentId], root).items.length, 0);
  const all = coordinationCommand(['todo', 'frontend', '--environment', environmentId, '--all'], root);
  assert.equal(all.items.length, 1);
  assert.equal(all.items[0].decision.kind, 'no_action');
  assert.equal(coordinationCommand(args, root).created, false);
  assert.equal(events(root).length, 1);
  assert.equal(bytes(runtimePath(root)), null);
});

test('CLI 部分申报经 flush 补齐且保留先前处置，旧代次确认失败后当前接收者可结束', t => {
  const root = fixture(t);
  const source = bind(root);
  const old = bind(root, 'manager');
  const lock = lockTodo(root, 'backend');
  const args = completeArgs(source, 'cli-recovery-phase');
  assert.throws(() => coordinationCommand(args, root), /完成申报已保存.*通知尚未齐/);
  const event = events(root)[0];
  const item = coordinationCommand(['todo', 'manager', '--environment', environmentId], root).items[0];
  coordinationCommand(['todo-ack', 'manager', item.id, ...identityArgs(old),
    '--decision', 'follow_up', '--note', '需在原授权内检查这一阶段'], root);
  const before = bytes(todoPath(root, 'manager'));
  unlinkSync(lock);
  assert.deepEqual(coordinationCommand(['flush', '--environment', environmentId], root),
    { environmentId, delivered: 3, pending: 0 });
  assert.deepEqual(bytes(todoPath(root, 'manager')), before);
  assert.equal(coordinationCommand(['todo', 'backend', '--environment', environmentId], root).unread, 1);
  const repeated = coordinationCommand(args, root);
  assert.equal(repeated.created, false);
  assert.equal(repeated.eventId, event.id);
  const current = bind(root, 'manager', { threadId: 'manager-next', expectedGeneration: old.generation });
  assert.throws(() => coordinationCommand(['todo-ack', 'manager', item.id, ...identityArgs(old),
    '--decision', 'done', '--note', '过期确认应被拒绝'], root), /会话或登记代次已变化/);
  assert.deepEqual(bytes(todoPath(root, 'manager')), before);
  const ended = coordinationCommand(['todo-ack', 'manager', item.id, ...identityArgs(current),
    '--decision', 'done', '--note', '当前接收角色已完成原授权内的检查'], root);
  assert.equal(ended.state, 'closed');
  assert.equal(coordinationCommand(['tick', '--environment', environmentId], root).noAction, true);
  assert.equal(events(root).length, 1);
  assert.equal(listCurrentSessions(root).length, 2);
  assert.equal(bytes(runtimePath(root)), null);
});

test('独审修正：全部条目为 follow_up 时自然接手仍提示未关闭数量及主检出待办路径', t => {
  const root = fixture(t);
  const source = bind(root, 'manager');
  const target = bind(root, 'frontend');
  complete(root, source, { taskKey: 'first-follow-up-phase' });
  complete(root, source, { taskKey: 'second-follow-up-phase' });
  for (const item of todos(root, 'frontend').items) {
    acknowledge(root, target, item.id, 'follow_up', '接收者仍需在原授权内跟进');
  }
  const pending = todos(root, 'frontend');
  assert.equal(pending.unread, 0);
  assert.equal(pending.followUp, 2);
  assert.equal(pending.pending, 2);
  assert.equal(pending.items.every(item => item.state === 'follow_up'), true);
  assert.equal(pending.todoPath, todoPath(root, 'frontend'));
  const journalBefore = bytes(journalPath(root));
  const todoBefore = bytes(todoPath(root, 'frontend'));
  const registryBefore = bytes(registryPath(root));
  const runtimeBefore = bytes(runtimePath(root));
  const result = nativeHook({ session_id: target.threadId, hook_event_name: 'SessionStart' }, root);
  const context = result.hookSpecificOutput.additionalContext;
  assert.match(context, /未读\s*0/);
  assert.match(context, /待跟进\s*2/);
  assert.match(context, /未关闭(?:共)?\s*2/);
  assert.ok(context.includes('主检出'));
  assert.ok(context.includes('agents/roles/frontend/.local/codex-local/todo.json'));
  assert.deepEqual(bytes(journalPath(root)), journalBefore);
  assert.deepEqual(bytes(todoPath(root, 'frontend')), todoBefore);
  assert.deepEqual(bytes(registryPath(root)), registryBefore);
  assert.deepEqual(bytes(runtimePath(root)), runtimeBefore);
});

test('独审修正：待办锁或坏文件只报告完成补偿故障，已有详细派工仍保留且原事件继续待补', t => {
  for (const fault of ['locked', 'corrupt']) {
    const root = fixture(t);
    const source = bind(root);
    const reviewer = bind(root, 'reviewer');
    const path = todoPath(root, 'backend');
    let lock;
    if (fault === 'locked') lock = lockTodo(root, 'backend');
    else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '{broken');
    }
    const event = partialEvent(root, completionInput(source));
    const requested = requestMessage({
      ...source, toRoleId: 'reviewer', taskKey: 'independent-review-request',
      authority: '用户已授权独立核对本次详细请求', subject: '检查既定证据', body: '请按原授权核对本次交付证据。',
    }, root);
    const journalBefore = bytes(journalPath(root));
    const registryBefore = bytes(registryPath(root));
    const runtimeBefore = bytes(runtimePath(root));
    const plan = coordinationCommand(['tick', '--environment', environmentId], root);
    assert.equal(plan.completionRepair.status, 'failed');
    assert.equal(typeof plan.completionRepair.error, 'string');
    assert.match(plan.completionRepair.error, fault === 'locked' ? /正被占用/ : /JSON/);
    assert.equal(plan.groups.length, 1);
    assert.equal(plan.groups[0].toRoleId, 'reviewer');
    assert.equal(plan.groups[0].session.threadId, reviewer.threadId);
    assert.deepEqual(plan.groups[0].messageIds, [requested.id]);
    assert.deepEqual(plan.groups[0].subjects, [{ taskKey: 'independent-review-request', subject: '检查既定证据' }]);
    assert.equal(plan.noAction, false);
    assert.equal(events(root)[0].id, event.id);
    assert.equal(events(root)[0].notifiedAt, null);
    assert.deepEqual(bytes(journalPath(root)), journalBefore);
    assert.deepEqual(bytes(registryPath(root)), registryBefore);
    assert.deepEqual(bytes(runtimePath(root)), runtimeBefore);
    if (fault === 'locked') {
      assert.equal(readFileSync(lock, 'utf8'), 'synthetic-held-todo-lock\n');
      unlinkSync(lock);
    } else {
      assert.equal(readFileSync(path, 'utf8'), '{broken');
      unlinkSync(path);
    }
    const repaired = coordinationCommand(['tick', '--environment', environmentId], root);
    assert.equal(Object.hasOwn(repaired, 'completionRepair'), false);
    assert.deepEqual(repaired.groups, plan.groups);
    assert.equal(events(root)[0].id, event.id);
    assert.notEqual(events(root)[0].notifiedAt, null);
    assert.deepEqual(bytes(runtimePath(root)), runtimeBefore);
    assert.deepEqual(bytes(registryPath(root)), registryBefore);
    const messages = inspectRuntime(environmentId, root).messages;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, requested.id);
    assert.equal(messages[0].state, 'pending');
  }
});

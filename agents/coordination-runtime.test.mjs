import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { coordinationState } from './coordination-state.mjs';
import {
  claimMessages, inspectRuntime, nativeHook, requestMessage, settleMessages, wakePlan,
} from './coordination-runtime.mjs';
import { localPaths, sourceRoot } from './local-store.mjs';
import { listCurrentSessions, sessionRegistry } from './session-registry.mjs';

const environmentId = 'codex-local';
const roleIds = ['manager', 'frontend', 'backend', 'wasm', 'authoring', 'reviewer'];

function fixture(t) {
  const temporaryRoot = realpathSync.native(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'damage-coordination-runtime-test-'));
  t.after(() => {
    const target = resolve(directory);
    assert.ok(target.startsWith(`${temporaryRoot}${sep}`)
      && basename(target).startsWith('damage-coordination-runtime-test-'));
    rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  });
  const root = join(directory, 'main');
  mkdirSync(join(root, 'agents', 'roles'), { recursive: true });
  for (const roleId of roleIds) writeFileSync(join(root, 'agents', 'roles', `${roleId}.md`), `# ${roleId}\n`);
  writeFileSync(join(root, 'agents', 'coordination.json'), readFileSync(join(sourceRoot, 'agents', 'coordination.json')));
  writeFileSync(join(root, '.gitignore'), '/agents/.local/\n');
  execFileSync('git', ['-c', 'init.defaultBranch=master', 'init', '-q'], { cwd: root, stdio: 'pipe' });
  return root;
}

function bind(root, roleId = 'manager', overrides = {}) {
  const binding = sessionRegistry({
    command: 'bind', roleId, environmentId, hostId: 'local', expectedGeneration: 0,
    threadId: `thread-${roleId}-${overrides.environmentId ?? environmentId}`, ...overrides,
  }, root);
  return { environmentId: binding.environmentId, roleId, threadId: binding.session.threadId, generation: binding.generation };
}

const messageInput = (identity, overrides = {}) => ({
  ...identity, toRoleId: 'reviewer', taskKey: 'test-review', authority: '用户已授权核对本次测试结果',
  subject: '核对测试结果', body: '请核对既定范围内的测试证据。', ...overrides,
});
const request = (root, identity, overrides = {}) => requestMessage(messageInput(identity, overrides), root);
const claim = (root, identity, messageIds, overrides = {}) => claimMessages({
  ...identity, messageIds, idleConfirmed: true, ...overrides,
}, root);
const settle = (root, dispatchToken, outcome, overrides = {}) => settleMessages({
  environmentId, dispatchToken, outcome, receipt: '已通过实际投递结果独立核对', ...overrides,
}, root);
const runtimePath = root => join(localPaths(root).localDirectory, 'coordination-runtime.json');
const runtimeBytes = root => existsSync(runtimePath(root)) ? readFileSync(runtimePath(root), 'utf8') : null;
const event = (root, identity, hook_event_name, turn_id = 'turn-1', overrides = {}) => nativeHook({
  session_id: identity.threadId, hook_event_name, turn_id, ...overrides,
}, root);

function clock(t) {
  const OriginalDate = globalThis.Date;
  let now = OriginalDate.parse('2026-11-18T00:00:00.000Z');
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  t.after(() => { globalThis.Date = OriginalDate; });
  return { advance(milliseconds) { now += milliseconds; } };
}

test('请求必须来自当前登记会话及代次，过期来源不能借去重绕过校验', t => {
  const root = fixture(t);
  const old = bind(root);
  bind(root, 'reviewer');
  const original = request(root, old);
  const current = bind(root, 'manager', { threadId: 'manager-replacement', expectedGeneration: 1 });
  const before = runtimeBytes(root);
  for (const identity of [old, { ...current, generation: 1 }, { ...current, threadId: old.threadId },
    { ...current, roleId: 'frontend' }, { ...current, environmentId: 'other-local' }]) {
    assert.throws(() => request(root, identity), /会话或登记代次已变化/);
    assert.equal(runtimeBytes(root), before);
  }
  assert.deepEqual(request(root, current), { id: original.id, state: 'pending', created: false });
});

test('同任务同内容去重，修改正文、摘要或授权依据均拒绝覆盖', t => {
  const root = fixture(t);
  const sender = bind(root);
  const first = request(root, sender);
  const before = runtimeBytes(root);
  assert.equal(first.created, true);
  assert.deepEqual(request(root, sender), { id: first.id, state: 'pending', created: false });
  for (const changed of [{ body: '内容不同' }, { subject: '摘要不同' }, { authority: '授权范围不同' }]) {
    assert.throws(() => request(root, sender, changed), /相同任务消息已存在/);
    assert.equal(runtimeBytes(root), before);
  }
  const next = request(root, sender, { taskKey: 'test-review-next', body: '明确的下一阶段任务' });
  assert.notEqual(next.id, first.id);
  assert.equal(inspectRuntime(environmentId, root).messages.length, 2);
});

test('关系为零的两组角色仍能定向请求并领取消息', t => {
  const root = fixture(t);
  for (const [fromRoleId, toRoleId] of [['frontend', 'authoring'], ['backend', 'wasm']]) {
    const sender = bind(root, fromRoleId);
    const target = bind(root, toRoleId);
    const requested = request(root, sender, { toRoleId, taskKey: `test-${fromRoleId}-${toRoleId}` });
    const claimed = claim(root, target, [requested.id]);
    assert.equal(claimed.messages[0].id, requested.id);
    assert.equal(claimed.messages[0].fromRoleId, fromRoleId);
    assert.equal(claimed.target.threadId, target.threadId);
    assert.equal(claimed.messages[0].body, '请核对既定范围内的测试证据。');
  }
});

test('无任务时不形成唤醒或创建会话，有待办但目标未绑定时仅返回计划', t => {
  const root = fixture(t);
  assert.deepEqual(listCurrentSessions(root), []);
  assert.deepEqual(wakePlan(environmentId, root), { environmentId, dispatchBudget: 2, groups: [], unresolved: [], noAction: true });
  assert.deepEqual(listCurrentSessions(root), []);
  const sender = bind(root);
  const before = listCurrentSessions(root);
  const pending = request(root, sender);
  const plan = wakePlan(environmentId, root);
  assert.equal(plan.noAction, false);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].toRoleId, 'reviewer');
  assert.equal(plan.groups[0].session, null);
  assert.deepEqual(plan.groups[0].messageIds, [pending.id]);
  assert.deepEqual(listCurrentSessions(root), before);
});

test('计划保留全部待办目标，派送预算为两个目标、同角色最多五条', t => {
  const root = fixture(t);
  const sender = bind(root, 'authoring');
  const target = bind(root);
  bind(root, 'reviewer');
  const managerIds = Array.from({ length: 7 }, (_, index) => request(root, sender, {
    toRoleId: 'manager', taskKey: `manager-task-${index}`,
  }).id);
  const one = wakePlan(environmentId, root);
  assert.equal(one.groups.length, 1);
  assert.equal(one.groups[0].messageIds.length, 5);
  assert.ok(one.groups[0].messageIds.every(id => managerIds.includes(id)));
  const delivered = claim(root, target, one.groups[0].messageIds);
  assert.equal(wakePlan(environmentId, root).groups.length, 0);
  settle(root, delivered.dispatchToken, 'sent');
  request(root, sender, { toRoleId: 'frontend', taskKey: 'frontend-task' });
  request(root, sender, { toRoleId: 'reviewer', taskKey: 'reviewer-task' });
  const sessionsBefore = listCurrentSessions(root);
  const plan = wakePlan(environmentId, root);
  assert.equal(plan.dispatchBudget, 2);
  assert.equal(plan.groups.length, 3);
  assert.equal(new Set(plan.groups.map(group => group.toRoleId)).size, 3);
  const states = new Map(inspectRuntime(environmentId, root).messages.map(message => [message.id, message.state]));
  for (const group of plan.groups) {
    assert.ok(group.messageIds.length >= 1 && group.messageIds.length <= 5);
    assert.ok(group.messageIds.every(id => states.get(id) === 'pending'));
  }
  assert.deepEqual(listCurrentSessions(root), sessionsBefore);
});

test('队首两个真实忙碌目标可以跳过，后续空闲目标仍能领取', t => {
  const root = fixture(t);
  const sender = bind(root, 'authoring');
  const manager = bind(root, 'manager');
  const frontend = bind(root, 'frontend');
  const reviewer = bind(root, 'reviewer');
  request(root, sender, { toRoleId: manager.roleId, taskKey: 'old-manager' });
  request(root, sender, { toRoleId: frontend.roleId, taskKey: 'old-frontend' });
  const expected = request(root, sender, { toRoleId: reviewer.roleId, taskKey: 'ready-reviewer' });
  const realBusyRoles = new Set(['manager', 'frontend']);
  const plan = wakePlan(environmentId, root);
  const available = plan.groups.filter(group => !realBusyRoles.has(group.toRoleId));
  assert.equal(available.length, 1);
  assert.equal(available[0].toRoleId, 'reviewer');
  const result = claim(root, reviewer, available[0].messageIds);
  assert.equal(result.messages[0].id, expected.id);
  const states = inspectRuntime(environmentId, root).messages;
  assert.equal(states.filter(message => message.state === 'pending').length, 2);
});

test('三次明确未投递后以失败结束，解除锁定并允许新任务和换代', t => {
  const root = fixture(t);
  const manager = bind(root);
  const reviewer = bind(root, 'reviewer');
  const pending = request(root, manager);
  let lastToken;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const sending = claim(root, reviewer, [pending.id]);
    lastToken = sending.dispatchToken;
    const result = settle(root, lastToken, 'not_sent');
    assert.equal(result.outcome, attempt < 3 ? 'pending' : 'failed');
  }
  assert.equal(settle(root, lastToken, 'not_sent').outcome, 'failed');
  assert.equal(wakePlan(environmentId, root).noAction, true);
  assert.equal(inspectRuntime(environmentId, root).messages[0].state, 'failed');
  const replacement = bind(root, 'reviewer', { threadId: 'reviewer-after-failure', expectedGeneration: 1 });
  const next = request(root, manager, { taskKey: 'explicit-new-phase' });
  const planned = wakePlan(environmentId, root);
  assert.deepEqual(planned.groups[0].messageIds, [next.id]);
  assert.equal(claim(root, replacement, [next.id]).messages[0].id, next.id);
});

test('领取要求明确闲置和当前目标代次，重复、错误或混合目标不会部分领取', t => {
  const root = fixture(t);
  const sender = bind(root);
  const oldTarget = bind(root, 'reviewer');
  const first = request(root, sender);
  const other = request(root, sender, { toRoleId: 'frontend', taskKey: 'frontend-task' });
  const target = bind(root, 'reviewer', { threadId: 'reviewer-replacement', expectedGeneration: 1 });
  const before = runtimeBytes(root);
  for (const idleConfirmed of [false, undefined, 'true', 1]) {
    assert.throws(() => claim(root, target, [first.id], { idleConfirmed }), /核对真实会话未运行/);
  }
  assert.throws(() => claim(root, oldTarget, [first.id]), /会话或登记代次已变化/);
  for (const ids of [[], [first.id, first.id], Array.from({ length: 6 }, (_, index) => `id-${index}`)]) {
    assert.throws(() => claim(root, target, ids), /1 至 5 条不同消息/);
  }
  for (const ids of [['missing'], [other.id], [first.id, other.id]]) {
    assert.throws(() => claim(root, target, ids), /目标不符或不存在/);
  }
  assert.equal(runtimeBytes(root), before);
  const claimed = claim(root, target, [first.id]);
  assert.equal(claimed.target.generation, 2);
  const sending = runtimeBytes(root);
  assert.throws(() => claim(root, target, [first.id]), /不能重复派送/);
  assert.equal(runtimeBytes(root), sending);
});

test('正在派送和结果未知期间禁止目标换代，未知结果不会自动重发', t => {
  const root = fixture(t);
  const sender = bind(root);
  const target = bind(root, 'reviewer');
  const pending = request(root, sender);
  const sending = claim(root, target, [pending.id]);
  const sessions = listCurrentSessions(root);
  const replace = () => bind(root, 'reviewer', { threadId: 'replacement', expectedGeneration: 1 });
  assert.throws(replace, /正在派送或结果不明/);
  settle(root, sending.dispatchToken, 'uncertain');
  assert.throws(replace, /正在派送或结果不明/);
  const before = runtimeBytes(root);
  for (let index = 0; index < 2; index += 1) {
    const plan = wakePlan(environmentId, root);
    assert.deepEqual(plan.groups, []);
    assert.equal(plan.unresolved.length, 1);
    assert.equal(plan.unresolved[0].id, pending.id);
    assert.equal(plan.unresolved[0].state, 'uncertain');
    assert.equal(plan.noAction, false);
  }
  assert.throws(() => claim(root, target, [pending.id]), /不能重复派送/);
  assert.equal(runtimeBytes(root), before);
  assert.deepEqual(listCurrentSessions(root), sessions);
});

test('确认已发送可重复结算且不改原回执，已发消息不再唤醒或阻止换代', t => {
  const root = fixture(t);
  const sender = bind(root);
  const target = bind(root, 'reviewer');
  const pending = request(root, sender);
  const sending = claim(root, target, [pending.id]);
  const sent = settle(root, sending.dispatchToken, 'sent', { receipt: '实际投递回执一' });
  const before = runtimeBytes(root);
  assert.deepEqual(settle(root, sending.dispatchToken, 'sent', { receipt: '重复确认无需重写' }), sent);
  assert.equal(runtimeBytes(root), before);
  assert.equal(inspectRuntime(environmentId, root).messages[0].receipt, '实际投递回执一');
  assert.throws(() => settle(root, sending.dispatchToken, 'not_sent'), /状态已变化/);
  assert.equal(runtimeBytes(root), before);
  assert.equal(wakePlan(environmentId, root).noAction, true);
  assert.equal(bind(root, 'reviewer', { threadId: 'reviewer-next', expectedGeneration: 1 }).generation, 2);
});

test('未发送必须提供明确核对依据才回待办，新领取使用新的派送编号', t => {
  const root = fixture(t);
  const sender = bind(root);
  const target = bind(root, 'reviewer');
  const pending = request(root, sender);
  let sending = claim(root, target, [pending.id]);
  const before = runtimeBytes(root);
  for (const receipt of [undefined, '', '  ']) {
    assert.throws(() => settle(root, sending.dispatchToken, 'not_sent', { receipt }), /回执或核对依据/);
    assert.equal(runtimeBytes(root), before);
  }
  const firstToken = sending.dispatchToken;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = settle(root, sending.dispatchToken, 'not_sent', { receipt: '已确认本次投递未发送' });
    assert.equal(result.outcome, 'pending');
    const brief = inspectRuntime(environmentId, root).messages[0];
    assert.equal(brief.target, null);
    assert.equal(brief.dispatchToken, null);
    assert.deepEqual(wakePlan(environmentId, root).groups[0].messageIds, [pending.id]);
    if (attempt === 1) {
      sending = claim(root, target, [pending.id]);
      assert.notEqual(sending.dispatchToken, firstToken);
      settle(root, sending.dispatchToken, 'uncertain');
    }
  }
});

test('消息、领取、回执和换代保护按环境隔离', t => {
  const root = fixture(t);
  const manager = bind(root);
  const reviewer = bind(root, 'reviewer');
  const alternateManager = bind(root, 'manager', { environmentId: 'other-local' });
  const alternateReviewer = bind(root, 'reviewer', { environmentId: 'other-local' });
  const first = request(root, manager);
  const second = request(root, alternateManager);
  assert.notEqual(first.id, second.id);
  const before = runtimeBytes(root);
  assert.throws(() => claim(root, reviewer, [second.id]), /目标不符或不存在/);
  assert.equal(runtimeBytes(root), before);
  const sending = claim(root, reviewer, [first.id]);
  assert.throws(() => settle(root, sending.dispatchToken, 'sent', { environmentId: 'other-local' }), /未找到派送编号/);
  assert.equal(inspectRuntime('other-local', root).messages[0].state, 'pending');
  assert.deepEqual(wakePlan('other-local', root).groups[0].messageIds, [second.id]);
  assert.equal(bind(root, 'reviewer', { environmentId: 'other-local', threadId: 'other-next', expectedGeneration: alternateReviewer.generation }).generation, 2);
  assert.equal(inspectRuntime(environmentId, root).messages[0].state, 'sending');
});

test('坏运行 JSON 或不符结构会让公开读写失败并保全原字节', t => {
  const root = fixture(t);
  const manager = bind(root);
  const reviewer = bind(root, 'reviewer');
  const pending = request(root, manager);
  const valid = JSON.parse(runtimeBytes(root));
  const cases = ['{broken', 'null', '[]', '{"formatVersion":2,"environments":{}}'];
  for (const mutate of [
    value => { value.environments[environmentId].messages[0].state = 'invalid'; },
    value => { value.environments[environmentId].messages.push(structuredClone(value.environments[environmentId].messages[0])); },
    value => { value.environments[environmentId].messages[0].state = 'sending'; },
    value => { value.environments[environmentId].actors.manager = { activity: 'invalid' }; },
  ]) {
    const value = structuredClone(valid);
    mutate(value);
    cases.push(JSON.stringify(value));
  }
  for (const content of cases) {
    writeFileSync(runtimePath(root), content);
    for (const operation of [
      () => inspectRuntime(environmentId, root), () => wakePlan(environmentId, root),
      () => request(root, manager), () => claim(root, reviewer, [pending.id]),
      () => event(root, manager, 'UserPromptSubmit'),
    ]) {
      assert.throws(operation, /JSON|结构无效|记录无效|身份缺失/);
      assert.equal(runtimeBytes(root), content);
    }
  }
});

test('未登记、无根轮次及带子代理身份的钩子不写运行记录', t => {
  const root = fixture(t);
  const manager = bind(root);
  const before = runtimeBytes(root);
  assert.deepEqual(event(root, { threadId: 'unregistered-session' }, 'UserPromptSubmit'), {});
  assert.deepEqual(event(root, manager, 'UserPromptSubmit', undefined, { turn_id: undefined }), {});
  for (const hook of ['Stop', 'PreCompact', 'PostCompact', 'Interrupt']) assert.deepEqual(event(root, manager, hook), {});
  for (const subagent of [{ agent_id: 'child-1' }, { agent_type: 'worker' },
    { subagent_id: 'child-2' }, { parent_session_id: manager.threadId }]) {
    for (const hook of ['SessionStart', 'UserPromptSubmit', 'PostCompact', 'Stop']) {
      assert.deepEqual(event(root, manager, hook, 'child-turn', subagent), {});
      assert.equal(runtimeBytes(root), before);
    }
  }
  assert.equal(runtimeBytes(root), before);
  const accepted = event(root, manager, 'UserPromptSubmit');
  assert.equal(accepted.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(inspectRuntime(environmentId, root).actors.manager.activity, 'running');
});

test('迟到的 Stop 和 PostCompact 不能覆盖当前根轮次或新代次', t => {
  const root = fixture(t);
  const manager = bind(root);
  event(root, manager, 'UserPromptSubmit', 'turn-old');
  event(root, manager, 'UserPromptSubmit', 'turn-current');
  const before = runtimeBytes(root);
  for (const hook of ['Stop', 'PostCompact']) assert.deepEqual(event(root, manager, hook, 'turn-old'), {});
  assert.equal(runtimeBytes(root), before);
  assert.equal(inspectRuntime(environmentId, root).actors.manager.activity, 'running');
  const current = bind(root, 'manager', { threadId: 'manager-next', expectedGeneration: 1 });
  event(root, current, 'UserPromptSubmit', 'turn-new-session');
  const replaced = runtimeBytes(root);
  for (const hook of ['Stop', 'PostCompact']) assert.deepEqual(event(root, manager, hook, 'turn-current'), {});
  assert.equal(runtimeBytes(root), replaced);
});

test('Stop 更新活动状态，不替角色刷新已发布的业务近况', t => {
  const root = fixture(t);
  const time = clock(t);
  const manager = bind(root);
  event(root, manager, 'UserPromptSubmit');
  time.advance(1000);
  const published = coordinationState({ command: 'publish', ...manager, state: 'waiting', current: '等待独立核对', needs: '检查证据', refs: [] }, root);
  const statusFile = join(localPaths(root).localDirectory, 'coordination-status.json');
  const before = readFileSync(statusFile, 'utf8');
  time.advance(1000);
  assert.deepEqual(event(root, manager, 'Stop'), {});
  assert.equal(inspectRuntime(environmentId, root).actors.manager.activity, 'idle');
  const brief = coordinationState({ command: 'status', environmentId, roleId: 'manager' }, root).roles[0];
  assert.equal(brief.state, 'waiting');
  assert.equal(brief.updatedAt, published.updatedAt);
  assert.equal(brief.revision, published.revision);
  assert.equal(readFileSync(statusFile, 'utf8'), before);
});

test('缺本轮 publish 时仅第一次 Stop 阻塞，stop_hook_active 不重复阻塞', t => {
  const root = fixture(t);
  const time = clock(t);
  const manager = bind(root);
  coordinationState({ command: 'publish', ...manager, state: 'idle', current: '上一轮已结束' }, root);
  const before = readFileSync(join(localPaths(root).localDirectory, 'coordination-status.json'), 'utf8');
  time.advance(1000);
  event(root, manager, 'UserPromptSubmit');
  time.advance(1000);
  const stopped = event(root, manager, 'Stop');
  assert.equal(stopped.decision, 'block');
  assert.match(stopped.reason, /本轮尚未发布/);
  const runtime = runtimeBytes(root);
  assert.deepEqual(event(root, manager, 'Stop', 'turn-1', { stop_hook_active: true }), {});
  assert.equal(runtimeBytes(root), runtime);
  assert.equal(readFileSync(join(localPaths(root).localDirectory, 'coordination-status.json'), 'utf8'), before);
  assert.equal(inspectRuntime(environmentId, root).actors.manager.activity, 'idle');
});

test('同轮压缩去重、旧轮压缩忽略，达到压缩阈值仍不会凭空创建任务', t => {
  const root = fixture(t);
  const manager = bind(root);
  for (let index = 1; index <= 3; index += 1) {
    const turnId = `turn-${index}`;
    event(root, manager, 'UserPromptSubmit', turnId);
    event(root, manager, 'PreCompact', turnId);
    event(root, manager, 'PostCompact', turnId);
    event(root, manager, 'PostCompact', turnId);
    assert.equal(inspectRuntime(environmentId, root).actors.manager.compactions, index);
    const before = runtimeBytes(root);
    event(root, manager, 'PostCompact', 'turn-stale');
    assert.equal(runtimeBytes(root), before);
  }
  assert.equal(wakePlan(environmentId, root).noAction, true);
  assert.equal(listCurrentSessions(root).length, 1);
});

test('SessionStart 只返回短角色上下文，不读取或回显提示、转录及末条消息', t => {
  const root = fixture(t);
  const manager = bind(root);
  const before = runtimeBytes(root);
  const result = event(root, manager, 'SessionStart', undefined, {
    prompt: '合成提示内容'.repeat(2000), last_assistant_message: '合成末条消息'.repeat(2000),
    transcript_path: join(root, '不存在且不应读取的转录.jsonl'),
  });
  const context = result.hookSpecificOutput.additionalContext;
  assert.equal(result.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(typeof context, 'string');
  assert.ok(context.length > 0 && context.length <= 512);
  assert.ok(context.includes('manager') && context.includes(environmentId));
  assert.doesNotMatch(JSON.stringify(result), /合成提示内容|合成末条消息|不存在且不应读取的转录/);
  assert.equal(runtimeBytes(root), before);
});

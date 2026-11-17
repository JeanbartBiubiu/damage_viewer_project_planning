import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sourceRoot, withLocalJson } from './local-store.mjs';
import { assertNoActivePolling, pollingState } from './polling-state.mjs';

const environmentId = 'codex-local';
const interval = 240 * 60_000;
const roleIds = ['manager', 'frontend', 'backend', 'wasm', 'authoring', 'reviewer'];
const originalConfig = JSON.parse(readFileSync(join(sourceRoot, 'agents', 'coordination.json'), 'utf8'));

function session(roleId, overrides = {}) {
  return { environmentId, roleId, threadId: `thread-${roleId}`, hostId: 'local', generation: 1,
    registeredAt: '2026-11-18T00:00:00.000Z', ...overrides };
}

function fixture(t, registered = ['manager', 'frontend'], clock = true) {
  const temporaryRoot = realpathSync.native(tmpdir());
  const root = mkdtempSync(join(temporaryRoot, 'damage-agent-polling-test-'));
  t.after(() => {
    const target = resolve(root);
    assert.ok(target.startsWith(`${temporaryRoot}${sep}`) && basename(target).startsWith('damage-agent-polling-test-'));
    rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  });
  mkdirSync(join(root, 'agents'));
  const config = structuredClone(originalConfig);
  config.policy.wakeEveryMinutes = 240;
  config.policy.pollingMode = 'observe_only';
  writeFileSync(join(root, 'agents', 'coordination.json'), JSON.stringify(config));
  execFileSync('git', ['-c', 'init.defaultBranch=master', 'init', '-q'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let now = Date.parse('2026-11-18T01:00:00.000Z');
  if (clock) t.mock.method(Date, 'now', () => now);
  const sessions = registered.map(roleId => session(roleId));
  const call = (command, fields = {}) => pollingState({ command, environmentId, ...fields }, sessions, root);
  const path = join(root, 'agents', '.local', 'polling.json');
  const status = () => call('status');
  const observe = (cycle, roleId, state = 'idle', fields = {}) => {
    const target = sessions.find(item => item.environmentId === environmentId && item.roleId === roleId) ?? session(roleId);
    return call('observe', { cycleId: cycle.cycleId, roleId, threadId: target.threadId,
      generation: target.generation, state, observedAt: new Date(Date.now()).toISOString(), ...fields });
  };
  const claim = (cycle, roleId = 'manager', fields = {}) => {
    const target = sessions.find(item => item.environmentId === environmentId && item.roleId === roleId) ?? session(roleId);
    return call('claim', { cycleId: cycle.cycleId, roleId, threadId: target.threadId, generation: target.generation, ...fields });
  };
  const claimLocal = (cycle, todoId, roleId = 'manager', fields = {}) => claim(cycle, roleId, {
    command: 'claim-local', todoId, ...fields,
  });
  const settle = (claimed, outcome = 'sent', receipt = '真实工具已接受本轮输入') => call('settle', {
    cycleId: claimed.cycleId, token: claimed.token, outcome, receipt,
  });
  return { root, sessions, path, call, status, observe, claim, claimLocal, settle, advance: delta => { now += delta; } };
}

test('查询不落盘，初始化只纳入当前环境已登记且配置已知的角色', t => {
  const f = fixture(t, ['frontend', 'manager']);
  f.sessions.push(session('other'), session('backend', { environmentId: 'other-env' }));
  const directory = join(f.root, 'agents', '.local');
  assert.deepEqual(f.status().rows, {});
  assertNoActivePolling(f.root, environmentId, 'manager');
  assert.equal(existsSync(directory), false);
  for (const request of [null, [], { command: 'other' }, { command: 'begin', environmentId, body: '不接收正文' },
    { command: 'begin', environmentId: 'Codex-local' }]) {
    assert.throws(() => pollingState(request, f.sessions, f.root), /轮询|结构|环境/);
  }
  assert.throws(() => pollingState({ command: 'begin', environmentId }, null, f.root), /真实会话登记数组/);
  assert.equal(existsSync(directory), false);
  const cycle = f.call('begin');
  assert.equal(cycle.status, 'ready');
  assert.deepEqual(cycle.candidates.map(item => item.roleId), ['manager', 'frontend']);
  assert.deepEqual(cycle.candidates[0], { roleId: 'manager', threadId: 'thread-manager', hostId: 'local', generation: 1 });
  const table = f.status();
  assert.deepEqual(Object.keys(table.rows), ['manager', 'frontend']);
  assert.equal(table.rows.manager.lastState, 'unknown');
  assert.equal(table.rows.manager.wakeCount, 0);
  assert.equal(table.lastWakeAt, null);
  assert.equal(table.lastCycleAt, new Date(Date.now()).toISOString());
  assert.deepEqual(f.call('begin'), cycle);
  const before = readFileSync(f.path, 'utf8');
  f.status();
  assert.equal(readFileSync(f.path, 'utf8'), before);
  assert.equal(existsSync(join(directory, 'sessions.json')), false);
});

test('两角色逐轮交替且换代保留唤醒次数并使旧观察失效', t => {
  const f = fixture(t);
  let cycle = f.call('begin');
  f.observe(cycle, 'manager');
  assert.equal(f.status().cursor, 'frontend');
  f.settle(f.claim(cycle));
  f.advance(interval);
  cycle = f.call('begin');
  assert.deepEqual(cycle.candidates.map(item => item.roleId), ['frontend', 'manager']);
  f.observe(cycle, 'frontend');
  f.settle(f.claim(cycle, 'frontend'));
  assert.equal(f.status().cursor, 'manager');
  assert.equal(f.status().rows.manager.wakeCount, 1);
  assert.equal(f.status().rows.frontend.wakeCount, 1);
  assert.equal(f.status().history.length, 2);
  const previousWake = f.status().rows.manager.lastWokenAt;
  f.sessions[0] = session('manager', { threadId: 'new-manager', generation: 2 });
  f.advance(interval);
  cycle = f.call('begin');
  assert.equal(cycle.candidates[0].roleId, 'manager');
  assert.equal(cycle.candidates[0].generation, 2);
  assert.equal(f.status().rows.manager.lastState, 'stale');
  assert.equal(f.status().rows.manager.lastCheckedAt, null);
  assert.equal(f.status().rows.manager.lastWokenAt, previousWake);
  assert.equal(f.status().rows.manager.wakeCount, 1);
  assert.throws(() => f.claim(cycle), /真实空闲观察/);
});

test('忙碌、未知和需输入逐个跳过，续办仍可检查后续空闲角色', t => {
  const f = fixture(t, roleIds.slice(0, 4));
  const cycle = f.call('begin');
  for (const [roleId, state] of [['manager', 'running'], ['frontend', 'unknown'], ['backend', 'needs_input']]) {
    assert.equal(f.observe(cycle, roleId, state).eligible, false);
    assert.throws(() => f.claim(cycle, roleId), /真实空闲观察/);
  }
  const resumed = f.call('begin');
  assert.equal(resumed.cycleId, cycle.cycleId);
  assert.deepEqual(resumed.candidates.map(item => item.roleId), ['wasm']);
  assert.equal(f.observe(resumed, 'wasm').eligible, true);
  assert.deepEqual(f.call('begin').candidates, []);
  const claimed = f.claim(cycle, 'wasm');
  assert.equal(claimed.target.roleId, 'wasm');
  assert.match(claimed.prompt, /只读查看本人待办和近况/);
  assert.match(claimed.prompt, /不自选新业务，不创建其他角色，不发送循环通知/);
  assert.equal(f.settle(claimed).outcome, 'sent');
});

test('空周期在开始时即占用四小时冷却，历史只保留最近二十个结束周期', t => {
  const f = fixture(t, []);
  let cycle = f.call('begin');
  assert.deepEqual(cycle.candidates, []);
  const started = Date.now();
  assert.equal(f.call('begin').cycleId, cycle.cycleId);
  f.call('finish', { cycleId: cycle.cycleId, reason: '本环境没有已登记会话' });
  const cooldown = f.call('begin');
  assert.equal(cooldown.status, 'cooldown');
  assert.equal(cooldown.cooldownUntil, new Date(started + interval).toISOString());
  f.advance(interval - 1);
  assert.equal(f.call('begin').status, 'cooldown');
  f.advance(1);
  const firstCycleId = cycle.cycleId;
  for (let index = 0; index < 20; index += 1) {
    cycle = f.call('begin');
    assert.equal(cycle.status, 'ready');
    f.call('finish', { cycleId: cycle.cycleId, reason: '本轮仍无登记会话' });
    f.advance(interval);
  }
  const table = f.status();
  assert.equal(table.history.length, 20);
  assert.equal(table.history.some(item => item.id === firstCycleId), false);
  assert.equal(table.activeCycle, null);
  assert.equal(table.lastWakeAt, null);
});

test('并发开始只产生同一周期，锁竞争明确失败且重复开始不会重置检查', { timeout: 15_000 }, async t => {
  const f = fixture(t, ['manager', 'frontend'], false);
  const moduleUrl = new URL('./polling-state.mjs', import.meta.url).href;
  const program = `import { pollingState } from ${JSON.stringify(moduleUrl)};
process.stdout.write('ready\\n');
process.stdin.once('data', () => {
  try {
    const result = pollingState({ command: 'begin', environmentId: 'codex-local' }, JSON.parse(process.argv[2]), process.argv[1]);
    process.stdout.write(JSON.stringify(result));
  } catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
  process.stdin.destroy();
});`;
  const children = [0, 1].map(() => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, f.root, JSON.stringify(f.sessions)], {
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000,
    });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stdout = '';
    let stderr = '';
    const ready = new Promise((resolveReady, reject) => {
      child.stdout.on('data', data => { stdout += data; if (stdout.startsWith('ready\n')) resolveReady(); });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('测试子进程准备前退出。')));
    });
    const done = new Promise((resolveDone, reject) => {
      child.once('error', reject);
      child.once('close', code => resolveDone({ code, stdout: stdout.slice('ready\n'.length), stderr }));
    });
    child.stderr.on('data', data => { stderr += data; });
    return { child, ready, done };
  });
  await Promise.all(children.map(child => child.ready));
  for (const child of children) child.child.stdin.end('开始\n');
  const results = await Promise.all(children.map(child => child.done));
  const successes = results.filter(result => result.code === 0).map(result => JSON.parse(result.stdout));
  assert.ok(successes.length >= 1);
  assert.equal(new Set(successes.map(result => result.cycleId)).size, 1);
  for (const result of results.filter(result => result.code !== 0)) {
    assert.equal(result.code, 1);
    assert.match(result.stderr, /polling\.json\.lock/);
  }
  const cycle = f.call('begin');
  assert.equal(cycle.cycleId, successes[0].cycleId);
  f.observe(cycle, 'manager', 'running');
  assert.deepEqual(f.call('begin').candidates.map(item => item.roleId), ['frontend']);
  const before = readFileSync(f.path, 'utf8');
  withLocalJson(f.root, 'polling.json', () => {
    assert.throws(() => f.call('begin'), /polling\.json\.lock/);
    return { result: undefined };
  });
  assert.equal(readFileSync(f.path, 'utf8'), before);
  assert.equal(f.status().history.length, 0);
});

test('过期、未来和倒退观察拒绝，空闲观察超过三十秒后不能领取', t => {
  const f = fixture(t);
  const cycle = f.call('begin');
  f.advance(1_000);
  const before = readFileSync(f.path, 'utf8');
  for (const delta of [-30_001, 5_001]) {
    assert.throws(() => f.observe(cycle, 'manager', 'idle', { observedAt: new Date(Date.now() + delta).toISOString() }), /已过期|未来/);
    assert.equal(readFileSync(f.path, 'utf8'), before);
  }
  assert.throws(() => f.observe(cycle, 'manager', 'idle', { observedAt: '2026-02-30T00:00:00Z' }), /ISO 时间/);
  f.observe(cycle, 'manager');
  assert.throws(() => f.observe(cycle, 'manager', 'running', { observedAt: new Date(Date.now() - 1).toISOString() }), /早于已记录/);
  f.advance(30_001);
  assert.throws(() => f.claim(cycle), /30 秒内/);
  assert.equal(f.observe(cycle, 'manager').eligible, true);
  f.advance(30_000);
  assert.equal(f.claim(cycle).target.roleId, 'manager');
});

test('检查阶段换代或解绑使旧观察陈旧，当前精确绑定重新观察后才可领取', t => {
  const f = fixture(t);
  const cycle = f.call('begin');
  f.observe(cycle, 'manager');
  f.sessions[0] = session('manager', { threadId: 'new-thread', generation: 2 });
  assert.throws(() => f.claim(cycle, 'manager', { threadId: 'thread-manager', generation: 1 }), /代次已变化/);
  assert.equal(f.observe(cycle, 'manager', 'idle', { threadId: 'thread-manager', generation: 1 }).state, 'stale');
  assert.equal(f.status().rows.manager.generation, 2);
  assert.throws(() => f.claim(cycle), /真实空闲观察/);
  f.sessions.splice(1, 1);
  const unbound = f.observe(cycle, 'frontend');
  assert.equal(unbound.state, 'stale');
  assert.equal(unbound.eligible, false);
  assert.equal(Object.hasOwn(f.status().rows, 'frontend'), false);
  assert.throws(() => f.claim(cycle, 'frontend'), /未绑定/);
  f.advance(1);
  assert.equal(f.observe(cycle, 'manager').eligible, true);
  assert.equal(f.claim(cycle).target.generation, 2);
});

test('每周期只有一次领取，未知结果保留目标直到真实读回结清', t => {
  const f = fixture(t);
  const cycle = f.call('begin');
  f.observe(cycle, 'manager');
  f.observe(cycle, 'frontend');
  const claimed = f.claim(cycle);
  assert.match(claimed.token, /^[0-9a-f-]{36}$/);
  assert.equal(f.status().activeCycle.phase, 'sending');
  assert.throws(() => f.claim(cycle, 'frontend'), /已领取或结果不明/);
  assert.equal(f.call('begin').status, 'needs_reconcile');
  assert.throws(() => f.settle({ ...claimed, token: randomUUID() }), /领取凭据不符/);
  f.settle(claimed, 'uncertain', '发送超时，尚未取得真实读回');
  const before = readFileSync(f.path, 'utf8');
  f.settle(claimed, 'uncertain', '发送超时，尚未取得真实读回');
  assert.equal(readFileSync(f.path, 'utf8'), before);
  assert.equal(f.status().activeCycle.receipt, '发送超时，尚未取得真实读回');
  assert.throws(() => f.call('finish', { cycleId: cycle.cycleId, reason: '不能放弃未知结果' }), /已领取或结果不明/);
  f.advance(interval * 2);
  const blocked = f.call('begin');
  assert.equal(blocked.status, 'needs_reconcile');
  assert.equal(blocked.cycleId, cycle.cycleId);
  assert.deepEqual(blocked.claim, { token: claimed.token, ...claimed.target });
  f.settle(claimed, 'sent', '真实读回确认目标已收到');
  assert.equal(f.status().activeCycle, null);
  assert.equal(f.status().rows.manager.wakeCount, 1);
});

test('明确失败结束本轮且继续冷却，成功和失败的相同终结回执均幂等', t => {
  const f = fixture(t);
  let cycle = f.call('begin');
  f.observe(cycle, 'manager');
  let claimed = f.claim(cycle);
  for (const receipt of ['', ' ', '字'.repeat(513)]) assert.throws(() => f.settle(claimed, 'not_sent', receipt), /非空文本/);
  const failed = f.settle(claimed, 'not_sent', '真实工具明确拒绝且未发送');
  const before = readFileSync(f.path, 'utf8');
  assert.deepEqual(f.settle(claimed, 'not_sent', failed.receipt), failed);
  assert.equal(readFileSync(f.path, 'utf8'), before);
  assert.equal(f.status().activeCycle, null);
  assert.equal(f.status().lastWakeAt, null);
  assert.equal(f.status().rows.manager.wakeCount, 0);
  assert.equal(f.status().history[0].outcome, 'not_sent');
  assert.equal(f.call('begin').status, 'cooldown');
  assert.throws(() => f.claim(cycle, 'frontend'), /周期不存在/);
  assert.throws(() => f.settle(claimed, 'sent', failed.receipt), /不能改写终结回执/);
  assert.throws(() => f.settle(claimed, 'not_sent', '另一个回执'), /不能改写终结回执/);
  assert.throws(() => f.settle({ ...claimed, token: randomUUID() }, 'not_sent', failed.receipt), /领取凭据不符/);
  f.advance(interval);
  cycle = f.call('begin');
  assert.equal(cycle.candidates[0].roleId, 'frontend');
  f.observe(cycle, 'frontend');
  claimed = f.claim(cycle, 'frontend');
  const sent = f.settle(claimed);
  const after = readFileSync(f.path, 'utf8');
  assert.deepEqual(f.settle(claimed), sent);
  assert.equal(readFileSync(f.path, 'utf8'), after);
  assert.equal(f.status().rows.frontend.wakeCount, 1);
  assert.equal(f.status().history.length, 2);
});

test('绑定守卫只锁定发送或未知结果的目标且不获取会话锁或改写轮询表', t => {
  const f = fixture(t);
  const configPath = join(f.root, 'agents', 'coordination.json');
  const configContent = readFileSync(configPath, 'utf8');
  unlinkSync(configPath);
  assertNoActivePolling(f.root, environmentId, 'manager');
  assert.equal(existsSync(join(f.root, 'agents', '.local')), false);
  writeFileSync(configPath, configContent);
  const cycle = f.call('begin');
  f.observe(cycle, 'manager');
  assertNoActivePolling(f.root, environmentId, 'manager');
  const claimed = f.claim(cycle);
  const before = readFileSync(f.path, 'utf8');
  unlinkSync(configPath);
  withLocalJson(f.root, 'sessions.json', () => {
    withLocalJson(f.root, 'polling.json', () => {
      assert.throws(() => assertNoActivePolling(f.root, environmentId, 'manager'), /先核对真实结果/);
      assertNoActivePolling(f.root, environmentId, 'frontend');
      assertNoActivePolling(f.root, 'other-env', 'manager');
      assert.equal(JSON.parse(readFileSync(f.path, 'utf8')).environments[environmentId].activeCycle.phase, 'sending');
      return { result: undefined };
    });
    return { result: undefined };
  });
  assert.equal(readFileSync(f.path, 'utf8'), before);
  assert.equal(existsSync(join(f.root, 'agents', '.local', 'sessions.json')), false);
  writeFileSync(configPath, configContent);
  f.settle(claimed, 'uncertain', '工具返回未知，等待读回');
  assert.throws(() => assertNoActivePolling(f.root, environmentId, 'manager'), /先核对真实结果/);
  f.settle(claimed, 'not_sent', '读回确认本轮未发送');
  unlinkSync(configPath);
  assertNoActivePolling(f.root, environmentId, 'manager');
});

test('损坏 JSON 和非法结构均保全原始字节，失败不遗留轮询锁', t => {
  const f = fixture(t);
  let cycle = f.call('begin');
  f.observe(cycle, 'manager');
  f.settle(f.claim(cycle));
  f.advance(interval);
  cycle = f.call('begin');
  f.observe(cycle, 'frontend');
  const valid = JSON.parse(readFileSync(f.path, 'utf8'));
  const cases = ['{broken', 'null', '[]'];
  const mutations = [
    value => { value.formatVersion = 2; },
    value => { value.privateBody = '不允许存正文'; },
    value => { value.environments = []; },
    value => { value.environments['Codex-local'] = {}; },
    value => { delete value.environments[environmentId].cursor; },
    value => { value.environments[environmentId].lastCycleAt = '昨天'; },
    value => { value.environments[environmentId].rows.manager.generation = 0; },
    value => { value.environments[environmentId].rows.manager.hostId = ''; },
    value => { value.environments[environmentId].rows.manager.lastState = 'working'; },
    value => { value.environments[environmentId].rows.manager.wakeCount = -1; },
    value => { value.environments[environmentId].rows.manager.wakeCount = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.environments[environmentId].rows.manager.lastWokenAt = '2026-02-30T00:00:00Z'; },
    value => { value.environments[environmentId].rows.frontend.lastCheckedAt = null; },
    value => { value.environments[environmentId].activeCycle.phase = 'sent'; },
    value => { value.environments[environmentId].activeCycle.checkedRoles = ['frontend', 'frontend']; },
    value => { value.environments[environmentId].activeCycle.phase = 'uncertain'; },
    value => { value.environments[environmentId].history[0].outcome = 'uncertain'; },
    value => { value.environments[environmentId].history[0].claim.token = ''; },
    value => { value.environments[environmentId].history[0].receipt = ''; },
    value => { value.environments[environmentId].history[0].outcome = 'deferred'; },
    value => { value.environments[environmentId].history[0].claim.todoId = 'todo-local'; },
    value => { value.environments[environmentId].history[0].claim.deliveryKind = 'local_todo'; },
    value => { Object.assign(value.environments[environmentId].history[0].claim, { deliveryKind: 'conversation', todoId: 'todo-local' }); },
    value => { Object.assign(value.environments[environmentId].history[0].claim, { deliveryKind: 'local_todo', todoId: 'todo-local' }); },
    value => { value.environments[environmentId].history.push(structuredClone(value.environments[environmentId].history[0])); },
    value => { value.environments[environmentId].history = Array(21).fill(value.environments[environmentId].history[0]); },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(valid);
    mutate(value);
    cases.push(JSON.stringify(value));
  }
  for (const content of cases) {
    writeFileSync(f.path, content);
    for (const operation of [() => f.call('begin'), () => f.status(), () => assertNoActivePolling(f.root, environmentId, 'manager')]) {
      assert.throws(operation, /本地登记|轮询|本地待办|角色|环境|ISO 时间/);
      assert.equal(readFileSync(f.path, 'utf8'), content);
      assert.equal(existsSync(`${f.path}.lock`), false);
    }
  }
});

test('本地领取共享空闲与代次预算，延后接手保留凭据且不计唤醒', t => {
  const f = fixture(t);
  const cycle = f.call('begin');
  assert.throws(() => f.claimLocal(cycle, 'todo-local'), /真实空闲观察/);
  f.observe(cycle, 'manager', 'needs_input');
  assert.throws(() => f.claimLocal(cycle, 'todo-local'), /真实空闲观察/);
  f.observe(cycle, 'manager');
  assert.throws(() => f.call('claim-local', { cycleId: cycle.cycleId, roleId: 'manager',
    threadId: 'thread-manager', generation: 1 }), /字段必须完整/);
  for (const todoId of [undefined, null, '', ' ', '待'.repeat(201)]) {
    assert.throws(() => f.claimLocal(cycle, todoId), /本地待办编号.*200 字符/);
  }
  assert.throws(() => f.claimLocal(cycle, 'todo-local', 'manager', { generation: 2 }), /代次已变化/);
  f.advance(30_001);
  assert.throws(() => f.claimLocal(cycle, 'todo-local'), /30 秒内/);
  f.observe(cycle, 'manager');
  const todoId = '待'.repeat(200);
  const claimed = f.claimLocal(cycle, todoId);
  assert.equal(claimed.todoId, todoId);
  assert.equal(claimed.prompt.length > 0, true);
  assert.deepEqual(f.status().activeCycle.claim, { token: claimed.token, ...claimed.target, deliveryKind: 'local_todo', todoId });
  assert.throws(() => f.claimLocal(cycle, 'todo-other', 'frontend'), /已领取或结果不明/);
  assert.throws(() => f.claim(cycle, 'frontend'), /已领取或结果不明/);
  assert.throws(() => assertNoActivePolling(f.root, environmentId, 'manager'), /先核对真实结果/);
  const before = readFileSync(f.path, 'utf8');
  assert.throws(() => f.settle(claimed, 'sent'), /本地待办领取不能结算为唤醒成功/);
  assert.equal(readFileSync(f.path, 'utf8'), before);
  const deferred = f.settle(claimed, 'deferred', '本地待办已写入，等待角色自然接手');
  const table = f.status();
  assert.equal(table.activeCycle, null);
  assert.equal(table.lastWakeAt, null);
  assert.equal(table.rows.manager.wakeCount, 0);
  assert.equal(table.rows.manager.lastWokenAt, null);
  assert.equal(table.history[0].outcome, 'deferred');
  assert.equal(table.history[0].claim.token, claimed.token);
  assert.equal(table.history[0].claim.todoId, todoId);
  const ended = readFileSync(f.path, 'utf8');
  assert.deepEqual(f.settle(claimed, 'deferred', deferred.receipt), deferred);
  assert.equal(readFileSync(f.path, 'utf8'), ended);
  assertNoActivePolling(f.root, environmentId, 'manager');
  f.advance(interval);
  const conversation = f.call('begin');
  f.observe(conversation, 'frontend');
  const ordinary = f.claim(conversation, 'frontend');
  assert.deepEqual(f.status().activeCycle.claim, { token: ordinary.token, ...ordinary.target });
  assert.equal(Object.hasOwn(ordinary, 'todoId'), false);
  assert.throws(() => f.settle(ordinary, 'deferred', '普通会话领取不能伪装本地待办'), /只有本地待办领取/);
});

test('本地未知结果保留待办编号与锁定目标，按本地回查依据延后结清', t => {
  const f = fixture(t);
  const cycle = f.call('begin');
  f.observe(cycle, 'manager');
  const claimed = f.claimLocal(cycle, 'todo-reconcile');
  f.settle(claimed, 'uncertain', '本地写入返回不明，等待按待办编号回查');
  const before = readFileSync(f.path, 'utf8');
  f.settle(claimed, 'uncertain', '本地写入返回不明，等待按待办编号回查');
  assert.equal(readFileSync(f.path, 'utf8'), before);
  f.advance(interval * 2);
  const pending = f.call('begin');
  assert.equal(pending.status, 'needs_reconcile');
  assert.equal(pending.cycleId, cycle.cycleId);
  assert.deepEqual(pending.claim, { token: claimed.token, ...claimed.target, deliveryKind: 'local_todo', todoId: claimed.todoId });
  assert.equal(f.status().activeCycle.phase, 'uncertain');
  assert.equal(f.status().activeCycle.startedAt, f.status().lastCycleAt);
  assert.throws(() => assertNoActivePolling(f.root, environmentId, 'manager'), /先核对真实结果/);
  assert.throws(() => f.claimLocal(cycle, 'todo-retry'), /已领取或结果不明/);
  assert.throws(() => f.settle({ ...claimed, token: randomUUID() }, 'deferred', '回查发现本地待办已存在'), /领取凭据不符/);
  assert.throws(() => f.settle(claimed, 'sent'), /本地待办领取不能结算为唤醒成功/);
  const endedAt = Date.now();
  f.settle(claimed, 'deferred', '按编号回查确认本地待办已存在，等待自然接手');
  assert.equal(f.status().activeCycle, null);
  assert.equal(f.status().history[0].claim.todoId, 'todo-reconcile');
  assert.equal(f.status().rows.manager.wakeCount, 0);
  assert.equal(f.status().lastWakeAt, null);
  assertNoActivePolling(f.root, environmentId, 'manager');
  assert.deepEqual(f.call('begin'), { status: 'cooldown', candidates: [], cooldownUntil: new Date(endedAt + interval).toISOString() });
});

test('发送或未知周期跨越四小时后才成功或明确失败，均从结清重新冷却', t => {
  for (const outcome of ['sent', 'not_sent']) {
    const f = fixture(t);
    const cycle = f.call('begin');
    const startedAt = f.status().lastCycleAt;
    f.observe(cycle, 'manager');
    const claimed = f.claim(cycle);
    if (outcome === 'not_sent') f.settle(claimed, 'uncertain', '本轮结果尚未确定');
    f.advance(interval + 60_000);
    assert.equal(f.call('begin').status, 'needs_reconcile');
    assert.equal(f.status().lastCycleAt, startedAt);
    assert.equal(f.status().activeCycle.startedAt, startedAt);
    const endedAt = Date.now();
    f.settle(claimed, outcome, outcome === 'sent' ? '迟到的真实回执确认已发送' : '真实读回确认未发送');
    assert.equal(f.status().lastWakeAt, outcome === 'sent' ? new Date(endedAt).toISOString() : null);
    assert.equal(f.status().rows.manager.wakeCount, outcome === 'sent' ? 1 : 0);
    assert.deepEqual(f.call('begin'), { status: 'cooldown', candidates: [], cooldownUntil: new Date(endedAt + interval).toISOString() });
    f.advance(interval - 1);
    assert.equal(f.call('begin').status, 'cooldown');
    f.advance(1);
    const next = f.call('begin');
    assert.equal(next.status, 'ready');
    assert.notEqual(next.cycleId, cycle.cycleId);
    assert.equal(f.status().activeCycle.startedAt, f.status().lastCycleAt);
  }
});

test('长时间检查仍续办原周期，空轮结束后按最近结束时间冷却', t => {
  const f = fixture(t, []);
  const cycle = f.call('begin');
  const startedAt = f.status().lastCycleAt;
  f.advance(interval + 1_000);
  assert.equal(f.call('begin').cycleId, cycle.cycleId);
  assert.equal(f.status().activeCycle.startedAt, startedAt);
  assert.equal(f.status().lastCycleAt, startedAt);
  const endedAt = Date.now();
  f.call('finish', { cycleId: cycle.cycleId, reason: '本轮没有已登记角色' });
  assert.equal(f.status().history[0].endedAt, new Date(endedAt).toISOString());
  assert.equal(f.status().lastCycleAt, startedAt);
  assert.deepEqual(f.call('begin'), { status: 'cooldown', candidates: [], cooldownUntil: new Date(endedAt + interval).toISOString() });
  f.advance(interval - 1);
  assert.equal(f.call('begin').status, 'cooldown');
  f.advance(1);
  assert.equal(f.call('begin').status, 'ready');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { coordinationCommand } from './coordination.mjs';
import { fixture, isIgnored } from './test-fixture.mjs';

const run = (root, ...args) => coordinationCommand(args, root);

test('角色集合与关系矩阵以配置为准，不对称的矩阵被拒绝', t => {
  const root = fixture(t);
  assert.ok(run(root, 'matrix').roles.includes('planner'));
  assert.deepEqual(run(root, 'peers', 'planner').peers.map(peer => peer.roleId), ['manager', 'reviewer']);
  const configPath = join(root, 'agents', 'coordination.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.relations.planner.frontend = 1;
  writeFileSync(configPath, JSON.stringify(config));
  assert.throws(() => run(root, 'matrix'), /对称/);
});

test('会话登记按角色记录工具与会话，一个会话不能承担两个角色，本地文件不进 Git', t => {
  const root = fixture(t);
  const unbound = run(root, 'resolve', 'manager');
  assert.equal(unbound.status, 'needs_session');
  assert.equal(unbound.todoPath, join(root, 'agents', 'roles', 'manager', '.local', 'todo.json'));
  assert.equal(run(root, 'bind', 'manager', '--tool', 'codex', '--session-id', 'session-1').status, 'ready');
  assert.equal(run(root, 'resolve', 'manager').session.sessionId, 'session-1');
  assert.throws(() => run(root, 'bind', 'reviewer', '--tool', 'codex', '--session-id', 'session-1'), /已登记给角色 manager/);
  assert.equal(run(root, 'bind', 'manager', '--tool', 'codex', '--session-id', 'session-2').session.sessionId, 'session-2');
  for (const path of ['agents/.local/sessions.json', 'agents/roles/manager/.local/todo.json', 'agents/roles/manager/.local/memory.md']) {
    assert.ok(isIgnored(root, path), path);
  }
});

test('近况只按角色发布，修订号递增，超时显示为陈旧，旧环境参数直接报错', t => {
  const root = fixture(t);
  assert.equal(run(root, 'status', 'planner').roles[0].availability, 'unknown');
  run(root, 'publish', 'manager', '--state', 'working', '--current', '实施方案 v1', '--ref', '文档记录/方案/README.md');
  const second = run(root, 'publish', 'manager', '--state', 'waiting', '--current', '等待评审');
  assert.equal(second.revision, 2);
  assert.equal(run(root, 'status').roles.length, 7);
  assert.equal(run(root, 'status', 'manager').roles[0].availability, 'available');
  const statusPath = join(root, 'agents', '.local', 'coordination-status.json');
  const store = JSON.parse(readFileSync(statusPath, 'utf8'));
  store.roles.manager.updatedAt = new Date(Date.now() - 7 * 3_600_000).toISOString();
  writeFileSync(statusPath, JSON.stringify(store));
  assert.equal(run(root, 'status', 'manager').roles[0].availability, 'stale');
  assert.throws(() => run(root, 'publish', 'manager', '--state', 'idle', '--current', '空闲', '--environment', 'local'), { code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' });
  assert.throws(() => run(root, 'publish', 'manager', '--state', 'idle', '--current', '空闲', '--ref', 'C:/secret.txt'), /相对路径/);
});

test('完成申报按矩阵写入关联角色待办，重复申报不新增，内容变化必须换阶段', t => {
  const root = fixture(t);
  const args = ['complete', 'manager', '--task', 'plan-x@v1', '--summary', '第一段完成', '--ref', 'contracts/x.md', '--attention', 'planner'];
  const first = run(root, ...args);
  assert.deepEqual(first.recipients.map(item => item.roleId), ['planner', 'frontend', 'backend', 'wasm', 'authoring', 'reviewer']);
  assert.ok(first.recipients.every(item => item.created && item.id === 'done:manager:plan-x@v1'));
  const [plannerItem] = run(root, 'todo', 'planner').items;
  assert.equal(plannerItem.attention, 'requested');
  assert.equal(run(root, 'todo', 'frontend').items[0].attention, 'check');
  assert.ok(run(root, ...args).recipients.every(item => !item.created));
  assert.throws(() => run(root, 'complete', 'manager', '--task', 'plan-x@v1', '--summary', '改了摘要', '--ref', 'contracts/x.md'), /内容不同/);
  assert.throws(() => run(root, 'complete', 'planner', '--task', 'p', '--summary', 's', '--ref', 'a.md', '--attention', 'frontend'), /关系为 1/);
  assert.throws(() => run(root, 'complete', 'manager', '--task', 'p', '--summary', 's'), /至少提供一条/);
});

test('定向通知不受矩阵限制，处置后默认列表隐藏已关闭项，读取不创建文件', t => {
  const root = fixture(t);
  run(root, 'todo', 'wasm');
  assert.equal(existsSync(join(root, 'agents', 'roles', 'wasm', '.local', 'todo.json')), false);
  const notice = run(root, 'notify', 'wasm', '--from', 'planner', '--task', 'plan-y@v2', '--summary', '方案已确认', '--ref', '文档记录/方案/plan-y.md');
  assert.equal(notice.id, 'notice:planner:plan-y@v2');
  assert.equal(run(root, 'todo', 'wasm').unread, 1);
  assert.equal(run(root, 'todo-ack', 'wasm', notice.id, '--decision', 'follow_up', '--note', '排进本轮').state, 'follow_up');
  assert.equal(run(root, 'todo', 'wasm').followUp, 1);
  run(root, 'todo-ack', 'wasm', notice.id, '--decision', 'done', '--note', '已处理');
  assert.equal(run(root, 'todo', 'wasm').items.length, 0);
  assert.equal(run(root, 'todo', 'wasm', '--all').items[0].decision.kind, 'done');
  assert.throws(() => run(root, 'todo-ack', 'wasm', 'missing', '--decision', 'done', '--note', 'x'), /没有待办/);
});

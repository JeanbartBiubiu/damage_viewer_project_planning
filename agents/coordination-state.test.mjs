import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { readCoordinationConfig, coordinationState } from './coordination-state.mjs';
import { localPaths, rolePaths, sourceRoot, withLocalJson } from './local-store.mjs';
import { sessionRegistry, withCurrentSession } from './session-registry.mjs';

const roleIds = ['manager', 'frontend', 'backend', 'wasm', 'authoring', 'reviewer'];
const statusFileName = 'coordination-status.json';
const environmentId = 'codex-local';
const recordKeys = ['threadId', 'generation', 'state', 'current', 'needs', 'refs', 'updatedAt', 'revision'];
const originalConfig = readFileSync(join(sourceRoot, 'agents', 'coordination.json'), 'utf8');
const configValue = () => JSON.parse(originalConfig);

function fixture(t) {
  const temporaryRoot = realpathSync.native(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'damage-agent-coordination-test-'));
  t.after(() => {
    const target = resolve(directory);
    assert.ok(target.startsWith(`${temporaryRoot}${sep}`)
      && basename(target).startsWith('damage-agent-coordination-test-'));
    rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  });
  const root = join(directory, 'main');
  for (const roleId of roleIds) {
    const roleDirectory = join(root, 'agents', 'roles', roleId);
    mkdirSync(roleDirectory, { recursive: true });
    writeFileSync(join(roleDirectory, 'README.md'), `# ${roleId}\n`);
  }
  writeFileSync(join(root, 'agents', 'coordination.json'), originalConfig);
  writeFileSync(join(root, '.gitignore'), '/agents/.local/\n/agents/roles/*/.local/\n');
  execFileSync('git', ['-c', 'init.defaultBranch=master', 'init', '-q'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return root;
}

function bind(root, roleId = 'manager', overrides = {}) {
  const binding = sessionRegistry({
    command: 'bind', environmentId, roleId,
    threadId: `thread-${roleId}-${overrides.environmentId ?? environmentId}`,
    hostId: 'local', expectedGeneration: 0, ...overrides,
  }, root);
  return { environmentId: binding.environmentId, roleId, threadId: binding.session.threadId, generation: binding.generation };
}

const publish = (root, identity, overrides = {}) => coordinationState({
  command: 'publish', ...identity, state: 'working', current: '正在核对约定', needs: '', refs: [], ...overrides,
}, root);
const query = (root, command = 'status', roleId, env = environmentId) => coordinationState({
  command, environmentId: env, ...(roleId === undefined ? {} : { roleId }),
}, root);
const readStore = (root, fileName = statusFileName) => withLocalJson(root, fileName, value => ({ result: value }));
const statusPath = root => join(localPaths(root).localDirectory, statusFileName);

test('配置完整列出六角色、对称交集和约定策略', t => {
  const root = fixture(t);
  const config = readCoordinationConfig(root);
  assert.deepEqual(config.roles, roleIds);
  assert.equal(config.formatVersion, 1);
  const expected = [
    [0, 1, 1, 1, 1, 1],
    [1, 0, 1, 1, 0, 1],
    [1, 1, 0, 0, 1, 1],
    [1, 1, 0, 0, 1, 1],
    [1, 0, 1, 1, 0, 1],
    [1, 1, 1, 1, 1, 0],
  ];
  assert.deepEqual(roleIds.map(roleId => roleIds.map(peerId => config.relations[roleId][peerId])), expected);
  assert.deepEqual(config.policy, {
    wakeEveryMinutes: 240, statusStaleMinutes: 360, maxCompactions: 3, maxSessionAgeDays: 7,
    pollingMode: 'observe_only',
  });
});

test('配置拒绝缺失、重复、未知角色及不完整、非法或非对称矩阵', t => {
  const root = fixture(t);
  const cases = [
    [value => { value.roles.pop(); }, /角色必须完整/],
    [value => { value.roles[5] = 'manager'; }, /角色必须完整/],
    [value => { value.roles[5] = 'other'; }, /角色必须完整/],
    [value => { value.roles[0] = 'Manager'; }, /角色必须完整/],
    [value => { delete value.relations.reviewer; }, /矩阵.*结构无效/],
    [value => { delete value.relations.manager.frontend; }, /矩阵.*结构无效/],
    [value => { value.relations.other = {}; }, /矩阵.*结构无效/],
    [value => { value.relations.manager.other = 1; }, /矩阵.*结构无效/],
    [value => { value.relations.manager = []; }, /矩阵.*结构无效/],
    [value => { value.relations.manager.frontend = '1'; }, /数字 0 或 1/],
    [value => { value.relations.manager.frontend = true; }, /数字 0 或 1/],
    [value => { value.relations.manager.frontend = 2; }, /数字 0 或 1/],
    [value => { value.relations.manager.frontend = -1; }, /数字 0 或 1/],
    [value => { value.relations.manager.frontend = 0.5; }, /数字 0 或 1/],
    [value => { value.relations.manager.manager = 1; }, /对角必须是 0/],
    [value => { value.relations.frontend.authoring = 1; }, /必须对称/],
  ];
  for (const [mutate, error] of cases) {
    const config = configValue();
    mutate(config);
    writeFileSync(join(root, 'agents', 'coordination.json'), JSON.stringify(config));
    assert.throws(() => readCoordinationConfig(root), error);
  }
});

test('配置拒绝无效版本、额外字段、损坏内容及非法策略，不写本机登记', t => {
  const root = fixture(t);
  const configPath = join(root, 'agents', 'coordination.json');
  const malformed = ['{broken', 'null', '[]', 'true', '{}'];
  for (const content of malformed) {
    writeFileSync(configPath, content);
    assert.throws(() => readCoordinationConfig(root), /协作配置/);
    assert.equal(readFileSync(configPath, 'utf8'), content);
  }
  const variants = [
    value => { value.formatVersion = 2; },
    value => { value.private = '额外字段'; },
    value => { delete value.policy.maxCompactions; },
    value => { value.policy.extra = 1; },
    value => { value.policy = []; },
  ];
  for (const key of ['wakeEveryMinutes', 'statusStaleMinutes', 'maxCompactions', 'maxSessionAgeDays']) {
    for (const invalid of [0, -1, 1.5, '30', null, Number.MAX_SAFE_INTEGER + 1]) {
      variants.push(value => { value.policy[key] = invalid; });
    }
  }
  for (const mutate of variants) {
    const config = configValue();
    mutate(config);
    writeFileSync(configPath, JSON.stringify(config));
    assert.throws(() => query(root), /协作配置|协作策略/);
  }
  assert.equal(existsSync(join(root, 'agents', '.local')), false);
});

test('无近况时返回全部六角色或单角色的 unknown，不创建近况文件', t => {
  const root = fixture(t);
  const result = query(root);
  assert.deepEqual(result, { environmentId, roles: roleIds.map(roleId => ({ roleId, availability: 'unknown' })) });
  assert.deepEqual(query(root, 'status', 'wasm'), { environmentId, roles: [{ roleId: 'wasm', availability: 'unknown' }] });
  assert.equal(existsSync(statusPath(root)), false);
});

test('真实绑定后按角色发布短近况，修订递增且不改变会话登记结构', t => {
  const root = fixture(t);
  const identity = bind(root);
  const registry = readStore(root, 'sessions.json');
  const first = publish(root, identity, { needs: '等待接口定义', refs: ['agents\\roles\\manager\\README.md', '文档记录/项目说明/开发指南/README.md'] });
  assert.equal(first.revision, 1);
  assert.deepEqual(first.refs, ['agents/roles/manager/README.md', '文档记录/项目说明/开发指南/README.md']);
  assert.ok(Number.isFinite(Date.parse(first.updatedAt)));
  const store = readStore(root);
  assert.deepEqual(Object.keys(store), ['formatVersion', 'environments']);
  assert.deepEqual(Object.keys(store.environments[environmentId].manager), recordKeys);
  assert.deepEqual(store.environments[environmentId].manager, {
    threadId: identity.threadId, generation: 1, state: 'working', current: '正在核对约定',
    needs: '等待接口定义', refs: first.refs, updatedAt: first.updatedAt, revision: 1,
  });
  assert.equal(statusPath(root), join(root, 'agents', '.local', statusFileName));
  for (const state of ['idle', 'working', 'waiting', 'blocked']) {
    const published = publish(root, identity, { state, current: `当前状态：${state}` });
    const [brief] = query(root, 'status', 'manager').roles;
    assert.equal(brief.availability, 'available');
    assert.equal(brief.state, state);
    assert.equal(brief.revision, published.revision);
    assert.equal(brief.current, `当前状态：${state}`);
  }
  assert.equal(readStore(root).environments[environmentId].manager.revision, 5);
  assert.deepEqual(readStore(root, 'sessions.json'), registry);
});

test('未绑定会话和旧代次不能发布，换回相同会话编号也不能复用旧代次', t => {
  const root = fixture(t);
  const first = bind(root);
  const frontend = { ...first, roleId: 'frontend' };
  assert.throws(() => publish(root, frontend), /会话或登记代次已变化/);
  assert.equal(existsSync(statusPath(root)), false);
  publish(root, first);
  const before = readFileSync(statusPath(root), 'utf8');
  const second = bind(root, 'manager', { threadId: 'thread-replacement', expectedGeneration: 1 });
  assert.equal(second.generation, 2);
  assert.equal(query(root, 'status', 'manager').roles[0].availability, 'stale');
  for (const identity of [first, { ...second, generation: 1 }, { ...first, generation: 2 }]) {
    assert.throws(() => publish(root, identity), /会话或登记代次已变化/);
    assert.equal(readFileSync(statusPath(root), 'utf8'), before);
  }
  const third = bind(root, 'manager', { threadId: first.threadId, expectedGeneration: 2 });
  assert.equal(third.generation, 3);
  assert.equal(query(root, 'status', 'manager').roles[0].availability, 'stale');
  assert.throws(() => publish(root, first), /会话或登记代次已变化/);
  assert.equal(readFileSync(statusPath(root), 'utf8'), before);
  assert.equal(publish(root, third, { current: '新代次已接手' }).revision, 2);
  assert.equal(query(root, 'status', 'manager').roles[0].availability, 'available');
});

test('环境与角色分别隔离，查询不泄露其他环境的近况', t => {
  const root = fixture(t);
  const manager = bind(root);
  const frontend = bind(root, 'frontend');
  const alternate = bind(root, 'manager', { environmentId: 'another-local' });
  publish(root, manager, { current: '本环境协调' });
  publish(root, frontend, { current: '本环境前端' });
  publish(root, alternate, { current: '另一环境私有进展' });
  const first = query(root);
  assert.equal(first.roles.find(role => role.roleId === 'manager').current, '本环境协调');
  assert.equal(first.roles.find(role => role.roleId === 'frontend').current, '本环境前端');
  assert.equal(JSON.stringify(first).includes('另一环境私有进展'), false);
  const second = query(root, 'status', undefined, 'another-local');
  assert.equal(second.roles[0].current, '另一环境私有进展');
  assert.equal(second.roles[0].availability, 'available');
  assert.equal(second.roles[1].availability, 'unknown');
  assert.equal(query(root, 'status', undefined, 'empty-local').roles.every(role => role.availability === 'unknown'), true);
  assert.deepEqual(Object.keys(readStore(root).environments).sort(), ['another-local', environmentId].sort());
});

test('peers 只返回交集为 1 的其他角色，显式查询仍可读取关系为 0 的角色', t => {
  const root = fixture(t);
  for (const roleId of roleIds) publish(root, bind(root, roleId), { current: `${roleId} 的简报` });
  const expected = {
    manager: ['frontend', 'backend', 'wasm', 'authoring', 'reviewer'],
    frontend: ['manager', 'backend', 'wasm', 'reviewer'],
    backend: ['manager', 'frontend', 'authoring', 'reviewer'],
    wasm: ['manager', 'frontend', 'authoring', 'reviewer'],
    authoring: ['manager', 'backend', 'wasm', 'reviewer'],
    reviewer: ['manager', 'frontend', 'backend', 'wasm', 'authoring'],
  };
  const { localDirectory } = localPaths(root);
  const { localRoleDirectory, memoryPath } = rolePaths(root, environmentId, 'manager');
  mkdirSync(localRoleDirectory, { recursive: true });
  const privateText = '私有详细消息不应被查询'.repeat(1000);
  writeFileSync(memoryPath, privateText);
  writeFileSync(join(localDirectory, 'messages.json'), `{坏 JSON：${privateText}`);
  const before = readFileSync(statusPath(root), 'utf8');
  for (const roleId of roleIds) {
    const result = query(root, 'peers', roleId);
    assert.deepEqual(result.peers.map(peer => peer.roleId), expected[roleId]);
    assert.equal(result.peers.every(peer => peer.availability === 'available'), true);
    assert.equal(JSON.stringify(result).includes('私有详细消息'), false);
    for (const brief of result.peers) {
      assert.deepEqual(Object.keys(brief).sort(), ['roleId', 'availability', ...recordKeys].sort());
    }
  }
  assert.equal(query(root, 'status', 'authoring').roles[0].current, 'authoring 的简报');
  assert.equal(query(root, 'status', 'wasm').roles[0].current, 'wasm 的简报');
  assert.equal(readFileSync(statusPath(root), 'utf8'), before);
});

test('超时边界按策略判断，查询只标记陈旧而不改记录', t => {
  const root = fixture(t);
  let now = Date.parse('2026-11-18T00:00:00.000Z');
  t.mock.method(Date, 'now', () => now);
  const identity = bind(root);
  publish(root, identity);
  const before = readFileSync(statusPath(root), 'utf8');
  now += 360 * 60_000;
  assert.equal(query(root, 'status', 'manager').roles[0].availability, 'available');
  now += 1;
  assert.equal(query(root, 'status', 'manager').roles[0].availability, 'stale');
  assert.equal(query(root, 'peers', 'reviewer').peers.find(peer => peer.roleId === 'manager').availability, 'stale');
  assert.equal(query(root, 'status', 'frontend').roles[0].availability, 'unknown');
  assert.equal(readFileSync(statusPath(root), 'utf8'), before);
  publish(root, identity);
  assert.equal(query(root, 'status', 'manager').roles[0].availability, 'available');
  const config = configValue();
  config.policy.statusStaleMinutes = 1;
  writeFileSync(join(root, 'agents', 'coordination.json'), JSON.stringify(config));
  now += 60_001;
  assert.equal(query(root, 'status', 'manager').roles[0].availability, 'stale');
});

test('字符及引用的合法边界完整保存，省略需要与引用时使用空值', t => {
  const root = fixture(t);
  const identity = bind(root);
  const current = '进'.repeat(160);
  const needs = '😀'.repeat(160);
  publish(root, identity, { current, needs, refs: ['agents/README.md', 'web/src/不存在.ts', '文档记录/项目说明/README.md'] });
  const [brief] = query(root, 'status', 'manager').roles;
  assert.equal(brief.current, current);
  assert.equal(brief.needs, needs);
  assert.equal(brief.refs.length, 3);
  const omitted = coordinationState({ command: 'publish', ...identity, state: 'idle', current: '等待任务' }, root);
  assert.equal(omitted.needs, '');
  assert.deepEqual(omitted.refs, []);
});

test('过长、空进展、非法状态或引用明确拒绝并保全已有近况', t => {
  const root = fixture(t);
  const identity = bind(root);
  publish(root, identity);
  const before = readFileSync(statusPath(root), 'utf8');
  const invalid = [
    [{ current: '' }, /当前进展/], [{ current: ' \n\t' }, /当前进展/],
    [{ current: null }, /当前进展/], [{ current: '进'.repeat(161) }, /160 字符/],
    [{ current: '😀'.repeat(161) }, /160 字符/],
    [{ needs: '需'.repeat(161) }, /160 字符/], [{ needs: null }, /协作需要/],
    [{ state: 'available' }, /近况状态/], [{ state: null }, /近况状态/],
    [{ refs: ['a', 'b', 'c', 'd'] }, /最多 3 条/], [{ refs: 'a' }, /最多 3 条/],
    [{ refs: [null] }, /仓库相对路径/], [{ refs: [''] }, /仓库相对路径/],
  ];
  for (const ref of ['../other', 'web/../agents/README.md', '/tmp/a', 'C:\\private', 'C:private',
    '\\\\server\\share', 'https://example.invalid/a', '.', './', 'web/..', 'bad\npath']) {
    invalid.push([{ refs: [ref] }, /相对路径/]);
  }
  for (const [fields, error] of invalid) {
    assert.throws(() => publish(root, identity, fields), error, JSON.stringify(fields));
    assert.equal(readFileSync(statusPath(root), 'utf8'), before);
  }
});

test('未知命令、角色、环境大小写和身份字段在产生状态副作用前失败', t => {
  const root = fixture(t);
  const identity = bind(root);
  for (const command of ['status', 'peers', 'publish']) {
    const base = command === 'publish'
      ? { command, ...identity, state: 'idle', current: '等待任务' }
      : { command, environmentId, roleId: 'manager' };
    for (const roleId of ['other', 'Manager', 'MANAGER', '../manager']) {
      assert.throws(() => coordinationState({ ...base, roleId }, root), /角色/);
    }
    for (const env of ['Codex-local', 'CODEX-LOCAL', '../other', '', 'x'.repeat(65)]) {
      assert.throws(() => coordinationState({ ...base, environmentId: env }, root), /环境/);
    }
    assert.throws(() => coordinationState({ ...base, privateMessage: '不接受详细消息' }, root), /不属于该命令/);
  }
  for (const request of [null, [], {}, { command: 'broadcast' }]) {
    assert.throws(() => coordinationState(request, root), /命令必须/);
  }
  for (const generation of [undefined, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => publish(root, { ...identity, generation }), /发布代次/);
  }
  for (const threadId of [undefined, '', '../thread', 'a b', 'a'.repeat(201)]) {
    assert.throws(() => publish(root, { ...identity, threadId }), /会话必须/);
  }
  assert.throws(() => query(root, 'peers'), /角色/);
  assert.equal(existsSync(statusPath(root)), false);
});

test('损坏或不符结构的近况不会被查询或发布覆盖，文件锁均得到清理', t => {
  const root = fixture(t);
  const identity = bind(root);
  publish(root, identity);
  const valid = readStore(root);
  const cases = ['{broken', 'null', '[]', '{"formatVersion":2,"environments":{}}'];
  const mutations = [
    value => { value.extra = 1; },
    value => { value.environments = []; },
    value => { value.environments['Codex-local'] = {}; },
    value => { value.environments[environmentId].other = {}; },
    value => { delete value.environments[environmentId].manager.needs; },
    value => { value.environments[environmentId].manager.privateMessage = '私有长文本'.repeat(500); },
    value => { value.environments[environmentId].manager.current = '进'.repeat(161); },
    value => { value.environments[environmentId].manager.state = 'unknown'; },
    value => { value.environments[environmentId].manager.updatedAt = '昨天'; },
    value => { value.environments[environmentId].manager.generation = 0; },
    value => { value.environments[environmentId].manager.revision = -1; },
    value => { value.environments[environmentId].manager.refs = ['../outside']; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(valid);
    mutate(value);
    cases.push(JSON.stringify(value));
  }
  for (const content of cases) {
    // 仅为模拟损坏文件直接写字节；正常状态读写均经共享辅助模块。
    writeFileSync(statusPath(root), content);
    for (const operation of [() => query(root), () => publish(root, identity)]) {
      assert.throws(operation, /本地登记|本机|近况|角色|环境|相对路径|160 字符/);
      assert.equal(readFileSync(statusPath(root), 'utf8'), content);
      assert.equal(existsSync(`${statusPath(root)}.lock`), false);
      assert.equal(existsSync(`${localPaths(root).registryPath}.lock`), false);
    }
  }
});

test('查询与发布先获取会话登记锁，锁竞争失败时不写状态也不遗留锁', t => {
  const root = fixture(t);
  const identity = bind(root);
  publish(root, identity);
  const before = readFileSync(statusPath(root), 'utf8');
  withCurrentSession(identity, root, () => withLocalJson(root, statusFileName, () => {
    // 两个锁同时已占用时，首先报告会话登记锁，证明没有反向拿锁。
    assert.throws(() => query(root), /sessions\.json\.lock/);
    assert.throws(() => publish(root, identity), /sessions\.json\.lock/);
    assert.throws(() => bind(root, 'manager', { threadId: 'new-thread', expectedGeneration: 1 }), /sessions\.json\.lock/);
    return { result: true };
  }));
  assert.equal(readFileSync(statusPath(root), 'utf8'), before);
  withLocalJson(root, statusFileName, () => {
    assert.throws(() => publish(root, identity), /coordination-status\.json\.lock/);
    assert.equal(existsSync(`${localPaths(root).registryPath}.lock`), false);
    return { result: true };
  });
  assert.equal(readFileSync(statusPath(root), 'utf8'), before);
  assert.equal(existsSync(`${statusPath(root)}.lock`), false);
  assert.equal(publish(root, identity).revision, 2);
});

test('修订号到达安全整数上限时拒绝更新并保全旧记录', t => {
  const root = fixture(t);
  const identity = bind(root);
  publish(root, identity);
  withLocalJson(root, statusFileName, value => {
    value.environments[environmentId].manager.revision = Number.MAX_SAFE_INTEGER;
    return { value };
  });
  const before = readFileSync(statusPath(root), 'utf8');
  assert.throws(() => publish(root, identity), /修订号必须是正安全整数/);
  assert.equal(readFileSync(statusPath(root), 'utf8'), before);
});

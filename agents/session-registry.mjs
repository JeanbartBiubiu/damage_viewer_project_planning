import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isRecord, localPaths, requireScope, sourceRoot, withLocalJson } from './local-store.mjs';
import { assertNoActiveDelivery } from './runtime-store.mjs';

const hasOwn = (value, key) => Object.hasOwn(value, key);

function requireIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value)) {
    throw new Error(`${label}必须是有效编号，不能包含空白或路径分隔符。`);
  }
}

function requireGeneration(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('预期代次必须是非负安全整数；首次登记使用 0。');
  }
}

function validateRegistry(value) {
  const invalid = () => { throw new Error('本机会话登记结构无效，已保留原文件。'); };
  if (!isRecord(value) || value.formatVersion !== 1 || !isRecord(value.environments)
      || Object.keys(value).length !== 2) invalid();
  for (const [environmentId, sessions] of Object.entries(value.environments)) {
    requireScope(environmentId, '登记环境');
    if (!isRecord(sessions)) invalid();
    for (const [roleId, session] of Object.entries(sessions)) {
      requireScope(roleId, '登记角色');
      if (!isRecord(session) || Object.keys(session).length !== 4
          || !hasOwn(session, 'threadId') || !hasOwn(session, 'hostId')
          || !hasOwn(session, 'generation') || !hasOwn(session, 'registeredAt')) invalid();
      requireIdentifier(session.threadId, '登记会话');
      requireIdentifier(session.hostId, '登记宿主');
      if (!Number.isSafeInteger(session.generation) || session.generation < 1
          || typeof session.registeredAt !== 'string'
          || !Number.isFinite(Date.parse(session.registeredAt))) invalid();
    }
  }
  return value;
}

function withRegistry(repositoryRoot, callback) {
  return withLocalJson(repositoryRoot, 'sessions.json', value => {
    const registry = value === null ? { formatVersion: 1, environments: {} } : validateRegistry(value);
    const change = callback(registry, value !== null);
    if (value === null && !Object.hasOwn(change, 'value')) change.value = registry;
    return change;
  });
}

export function listCurrentSessions(repositoryRoot = sourceRoot) {
  return withSessionSnapshot(repositoryRoot, sessions => sessions);
}

export function withSessionSnapshot(repositoryRoot, callback) {
  return withRegistry(repositoryRoot, registry => ({ result: callback(
    Object.entries(registry.environments).flatMap(([environmentId, sessions]) =>
      Object.entries(sessions).map(([roleId, session]) => ({ environmentId, roleId, ...session })))),
  }));
}

// 持有会话登记锁直到同步操作结束，使旧会话不能在换代后提交近况或消息。
export function withCurrentSession(request, repositoryRoot = sourceRoot, callback) {
  requireScope(request.environmentId, '环境');
  requireScope(request.roleId, '角色');
  requireIdentifier(request.threadId, '会话');
  requireGeneration(request.generation);
  return withRegistry(repositoryRoot, registry => {
    const current = registry.environments[request.environmentId]?.[request.roleId];
    if (!current || current.threadId !== request.threadId || current.generation !== request.generation) {
      throw new Error('当前角色会话或登记代次已变化，请重新查询有效会话。');
    }
    return { result: callback({ environmentId: request.environmentId, roleId: request.roleId, ...current }) };
  });
}

// 只管理登记事实，不创建会话、发送任务或撤销旧会话的真实权限。
export function sessionRegistry(request, repositoryRoot = sourceRoot) {
  const { command, roleId, environmentId, threadId, hostId, expectedGeneration } = request;
  if (!['init', 'resolve', 'bind'].includes(command)) {
    throw new Error('命令必须是 init、resolve 或 bind。');
  }
  if (command !== 'init') {
    requireScope(roleId, '角色');
    requireScope(environmentId, '环境');
    const definitionPath = join(repositoryRoot, 'agents', 'roles', `${roleId}.md`);
    if (!existsSync(definitionPath) || !statSync(definitionPath).isFile()) {
      throw new Error('角色定义不存在，请先核对 agents/roles/。');
    }
  }
  if (command === 'bind') {
    requireIdentifier(threadId, '会话');
    requireIdentifier(hostId, '宿主');
    requireGeneration(expectedGeneration);
  }

  const { localDirectory, registryPath } = localPaths(repositoryRoot);
  return withRegistry(repositoryRoot, (registry, existing) => {
    let changed = !existing;
    let result = { status: existing ? 'existing' : 'initialized', registryPath };
    if (command !== 'init') {
      const sessions = hasOwn(registry.environments, environmentId) ? registry.environments[environmentId] : {};
      const current = hasOwn(sessions, roleId) ? sessions[roleId] : null;
      let active = current;
      if (command === 'bind') {
        const generation = current?.generation ?? 0;
        if (generation !== expectedGeneration) {
          throw new Error(`会话登记已变化：预期代次 ${expectedGeneration}，当前代次 ${generation}；请重新 resolve。`);
        }
        if (current?.threadId !== threadId || current?.hostId !== hostId) {
          assertNoActiveDelivery(repositoryRoot, environmentId, roleId);
          const duplicate = Object.entries(registry.environments).some(([otherEnvironment, roles]) =>
            Object.entries(roles).some(([otherRole, session]) => session.threadId === threadId
              && session.hostId === hostId && (otherEnvironment !== environmentId || otherRole !== roleId)));
          if (duplicate) throw new Error('该会话已登记给另一角色或环境，不能同时承担两个长期角色。');
          if (generation === Number.MAX_SAFE_INTEGER) throw new Error('登记代次已达上限，不能继续绑定。');
          active = { threadId, hostId, generation: generation + 1, registeredAt: new Date().toISOString() };
          sessions[roleId] = active;
          registry.environments[environmentId] = sessions;
          changed = true;
        }
      }
      result = {
        status: active ? 'ready' : 'needs_session', registryPath, environmentId, roleId,
        definitionPath: join(repositoryRoot, 'agents', 'roles', `${roleId}.md`),
        memoryPath: join(localDirectory, 'memory', environmentId, `${roleId}.md`),
        generation: active?.generation ?? 0, session: active,
      };
    }
    return changed ? { value: registry, result } : { result };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        environment: { type: 'string' }, 'thread-id': { type: 'string' },
        'host-id': { type: 'string' }, 'expected-generation': { type: 'string' },
      },
    });
    const [command, roleId] = positionals;
    if (positionals.length !== (command === 'init' ? 1 : 2)
        || (command !== 'bind' && ['thread-id', 'host-id', 'expected-generation'].some(key => hasOwn(values, key)))
        || (command === 'init' && hasOwn(values, 'environment'))) {
      throw new Error('参数不符合命令用途，请查看 agents/README.md。');
    }
    const rawGeneration = values['expected-generation'];
    if (command === 'bind' && !/^(0|[1-9][0-9]*)$/.test(rawGeneration ?? '')) {
      throw new Error('bind 必须提供 --expected-generation 非负整数。');
    }
    const result = sessionRegistry({
      command, roleId, environmentId: values.environment, threadId: values['thread-id'],
      hostId: values['host-id'], expectedGeneration: rawGeneration === undefined ? undefined : Number(rawGeneration),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`会话登记失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

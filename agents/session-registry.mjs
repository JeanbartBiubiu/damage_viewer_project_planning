import { readCoordinationConfig, requireRole } from './coordination-state.mjs';
import { requireScope, rolePaths, sourceRoot, withLocalJson } from './local-store.mjs';

const registryFileName = 'sessions.json';

function readRoles(value) {
  return value === null ? {} : value.roles;
}

export function resolveRole(roleId, repositoryRoot = sourceRoot) {
  requireRole(readCoordinationConfig(repositoryRoot), roleId);
  const paths = rolePaths(repositoryRoot, roleId);
  const session = withLocalJson(repositoryRoot, registryFileName, value => ({ result: readRoles(value)[roleId] ?? null }));
  return { status: session ? 'ready' : 'needs_session', roleId, session, ...paths };
}

// 登记只记录角色由哪个工具的哪个会话承担，不创建、唤醒或停止会话。
export function bindRole({ roleId, tool, sessionId }, repositoryRoot = sourceRoot) {
  requireRole(readCoordinationConfig(repositoryRoot), roleId);
  requireScope(tool, '工具');
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(sessionId)) {
    throw new Error('会话编号必须是不含空白和路径分隔符的有效编号。');
  }
  return withLocalJson(repositoryRoot, registryFileName, value => {
    const store = value ?? { roles: {} };
    const owner = Object.entries(store.roles).find(([otherRole, session]) => otherRole !== roleId && session.sessionId === sessionId);
    if (owner) throw new Error(`会话 ${sessionId} 已登记给角色 ${owner[0]}，一个会话只承担一个长期角色。`);
    store.roles[roleId] = { tool, sessionId, registeredAt: new Date().toISOString() };
    return { value: store, result: { status: 'ready', roleId, session: store.roles[roleId] } };
  });
}

export function findRoleBySession(sessionId, repositoryRoot = sourceRoot) {
  return withLocalJson(repositoryRoot, registryFileName, value => ({
    result: Object.entries(readRoles(value)).find(([, session]) => session.sessionId === sessionId)?.[0] ?? null,
  }));
}

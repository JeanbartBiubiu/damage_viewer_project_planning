import { readFileSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { isRecord, requireScope, sourceRoot, withLocalJson } from './local-store.mjs';
import { listCurrentSessions, withCurrentSession } from './session-registry.mjs';

const roleIds = ['manager', 'frontend', 'backend', 'wasm', 'authoring', 'reviewer'];
const policyKeys = ['wakeEveryMinutes', 'statusStaleMinutes', 'maxCompactions', 'maxSessionAgeDays'];
const recordKeys = ['threadId', 'generation', 'state', 'current', 'needs', 'refs', 'updatedAt', 'revision'];
const states = ['idle', 'working', 'waiting', 'blocked'];
const statusFileName = 'coordination-status.json';

function requireKeys(value, keys, label) {
  if (!isRecord(value) || Object.keys(value).length !== keys.length
      || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`${label}结构无效，字段必须完整且不能包含其他字段。`);
  }
}

function requireRole(roleId, label = '角色') {
  requireScope(roleId, label);
  if (!roleIds.includes(roleId)) throw new Error(`${label}未知，必须是六个长期角色之一。`);
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label}必须是正安全整数。`);
}

export function readCoordinationConfig(repositoryRoot = sourceRoot) {
  let config;
  try {
    config = JSON.parse(readFileSync(join(repositoryRoot, 'agents', 'coordination.json'), 'utf8'));
  } catch (error) {
    throw new Error('无法读取协作配置 agents/coordination.json，请核对文件及 JSON 格式。', { cause: error });
  }
  requireKeys(config, ['formatVersion', 'roles', 'relations', 'policy'], '协作配置');
  if (config.formatVersion !== 1) throw new Error('协作配置版本必须是 1。');
  if (!Array.isArray(config.roles) || config.roles.length !== roleIds.length
      || new Set(config.roles).size !== roleIds.length
      || roleIds.some(roleId => !config.roles.includes(roleId))) {
    throw new Error('协作配置角色必须完整包含六个长期角色，不能重复或包含未知角色。');
  }
  requireKeys(config.relations, roleIds, '协作关系矩阵');
  for (const roleId of roleIds) {
    requireKeys(config.relations[roleId], roleIds, `协作关系矩阵的 ${roleId} 行`);
    for (const peerId of roleIds) {
      const relation = config.relations[roleId][peerId];
      if (relation !== 0 && relation !== 1) throw new Error('协作关系矩阵的值只能是数字 0 或 1。');
      if (roleId === peerId && relation !== 0) throw new Error('协作关系矩阵的对角必须是 0。');
    }
  }
  for (const roleId of roleIds) {
    for (const peerId of roleIds) {
      if (config.relations[roleId][peerId] !== config.relations[peerId][roleId]) {
        throw new Error('协作关系矩阵必须对称，双向关系不能不同。');
      }
    }
  }
  requireKeys(config.policy, [...policyKeys, 'pollingMode'], '协作策略');
  for (const key of policyKeys) requirePositiveInteger(config.policy[key], `协作策略 ${key}`);
  if (!['observe_only', 'idle_recheck'].includes(config.policy.pollingMode)) throw new Error('轮询发送规则必须是 observe_only 或 idle_recheck。');
  return config;
}

function requireText(value, label, allowEmpty = false) {
  if (typeof value !== 'string' || [...value].length > 160 || (!allowEmpty && !value.trim())) {
    throw new Error(`${label}必须是最多 160 字符的文本${allowEmpty ? '，允许为空' : '，且不能为空'}。`);
  }
}

export function normalizeRefs(refs) {
  if (!Array.isArray(refs) || refs.length > 3) throw new Error('引用必须是最多 3 条仓库相对路径。');
  return Array.from(refs, ref => {
    if (typeof ref !== 'string' || !ref.trim() || /[\x00-\x1f\x7f:]/.test(ref)
        || win32.isAbsolute(ref) || posix.isAbsolute(ref)) {
      throw new Error('引用必须是非空的仓库相对路径，不能包含绝对路径、控制字符或地址协议。');
    }
    const normalized = ref.replaceAll('\\', '/');
    const segments = normalized.split('/');
    if (segments.includes('..') || segments.every(segment => segment === '.' || segment === '')) {
      throw new Error('引用必须指向仓库内的相对路径，不能引用父目录或仅引用当前目录。');
    }
    return posix.normalize(normalized);
  });
}

function requireSummary(value) {
  if (!states.includes(value.state)) throw new Error('近况状态必须是 idle、working、waiting 或 blocked。');
  requireText(value.current, '当前进展');
  requireText(value.needs, '协作需要', true);
  return normalizeRefs(value.refs);
}

function validateStore(value) {
  if (value === null) return { formatVersion: 1, environments: {} };
  requireKeys(value, ['formatVersion', 'environments'], '本机近况登记');
  if (value.formatVersion !== 1 || !isRecord(value.environments)) {
    throw new Error('本机近况登记版本或环境结构无效，已保留原文件。');
  }
  for (const [environmentId, roles] of Object.entries(value.environments)) {
    requireScope(environmentId, '近况登记环境');
    if (!isRecord(roles)) throw new Error('本机近况登记的角色结构无效，已保留原文件。');
    for (const [roleId, record] of Object.entries(roles)) {
      requireRole(roleId, '近况登记角色');
      requireKeys(record, recordKeys, '本机角色近况');
      requireThread(record.threadId);
      requirePositiveInteger(record.generation, '近况登记代次');
      requirePositiveInteger(record.revision, '近况修订号');
      requireSummary(record);
      if (typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) {
        throw new Error('本机角色近况的更新时间无效，已保留原文件。');
      }
    }
  }
  return value;
}

function requireThread(threadId) {
  if (typeof threadId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(threadId)) {
    throw new Error('会话必须是有效编号，不能包含空白或路径分隔符。');
  }
}

function validateRequest(request) {
  if (!isRecord(request) || !['publish', 'status', 'peers'].includes(request.command)) {
    throw new Error('协作近况命令必须是 publish、status 或 peers。');
  }
  const allowed = request.command === 'publish'
    ? ['command', 'environmentId', 'roleId', 'threadId', 'generation', 'state', 'current', 'needs', 'refs']
    : ['command', 'environmentId', 'roleId'];
  if (Object.keys(request).some(key => !allowed.includes(key))) {
    throw new Error('协作近况请求包含不属于该命令的字段。');
  }
  requireScope(request.environmentId, '环境');
  if (request.command !== 'status' || request.roleId !== undefined) requireRole(request.roleId);
  if (request.command === 'publish') {
    requireThread(request.threadId);
    requirePositiveInteger(request.generation, '发布代次');
    const summary = {
      state: request.state, current: request.current,
      needs: Object.hasOwn(request, 'needs') ? request.needs : '',
      refs: Object.hasOwn(request, 'refs') ? request.refs : [],
    };
    return { ...request, ...summary, refs: requireSummary(summary) };
  }
  return request;
}

function roleBrief(roleId, records, sessions, staleMinutes, now) {
  const record = Object.hasOwn(records, roleId) ? records[roleId] : null;
  if (!record) return { roleId, availability: 'unknown' };
  const session = sessions.find(item => item.roleId === roleId);
  const stale = !session || session.threadId !== record.threadId || session.generation !== record.generation
    || (now - Date.parse(record.updatedAt)) / 60_000 > staleMinutes;
  // 显式投影短字段；不读取会话消息、角色笔记或引用指向的内容。
  return {
    roleId, availability: stale ? 'stale' : 'available',
    threadId: record.threadId, generation: record.generation, state: record.state,
    current: record.current, needs: record.needs, refs: [...record.refs],
    updatedAt: record.updatedAt, revision: record.revision,
  };
}

// status 始终返回 roles 数组（全部六角色或指定的一个）；peers 返回 peers 数组。
export function coordinationState(request, repositoryRoot = sourceRoot) {
  const input = validateRequest(request);
  const config = readCoordinationConfig(repositoryRoot);
  const { environmentId, roleId } = input;
  if (input.command === 'publish') {
    // 持有会话登记锁直至近况原子更新完成，换代不能插入身份核对和落盘之间。
    return withCurrentSession(input, repositoryRoot, session =>
      withLocalJson(repositoryRoot, statusFileName, value => {
        const store = validateStore(value);
        const roles = Object.hasOwn(store.environments, environmentId) ? store.environments[environmentId] : {};
        const revision = (roles[roleId]?.revision ?? 0) + 1;
        requirePositiveInteger(revision, '近况修订号');
        const record = {
          threadId: session.threadId, generation: session.generation,
          state: input.state, current: input.current, needs: input.needs, refs: [...input.refs],
          updatedAt: new Date(Date.now()).toISOString(), revision,
        };
        roles[roleId] = record;
        store.environments[environmentId] = roles;
        return { value: store, result: { environmentId, roleId, ...record } };
      }));
  }

  // 先释放会话登记快照的锁，再读近况；禁止在近况锁内反向获取会话锁。
  const sessions = listCurrentSessions(repositoryRoot).filter(session => session.environmentId === environmentId);
  return withLocalJson(repositoryRoot, statusFileName, value => {
    const store = validateStore(value);
    const records = Object.hasOwn(store.environments, environmentId) ? store.environments[environmentId] : {};
    // 关系 0 仅不默认关注，显式 status 查询任何已定义角色仍然有效。
    const selected = input.command === 'peers'
      ? config.roles.filter(peerId => peerId !== roleId && config.relations[roleId][peerId] === 1)
      : roleId === undefined ? config.roles : [roleId];
    const now = Date.now();
    const briefs = selected.map(peerId => roleBrief(peerId, records, sessions, config.policy.statusStaleMinutes, now));
    return { result: input.command === 'peers'
      ? { environmentId, roleId, peers: briefs }
      : { environmentId, roles: briefs } };
  });
}

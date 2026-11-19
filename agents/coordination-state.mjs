import { readFileSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { requireScope, sourceRoot, withLocalJson } from './local-store.mjs';

const states = ['idle', 'working', 'waiting', 'blocked'];
const statusFileName = 'coordination-status.json';

export function readCoordinationConfig(repositoryRoot = sourceRoot) {
  const config = JSON.parse(readFileSync(join(repositoryRoot, 'agents', 'coordination.json'), 'utf8'));
  const { roles, relations, policy } = config;
  if (new Set(roles).size !== roles.length) throw new Error('协作配置的角色不能重复。');
  for (const roleId of roles) {
    requireScope(roleId, '协作配置角色');
    for (const peerId of roles) {
      const relation = relations[roleId]?.[peerId];
      if ((relation !== 0 && relation !== 1) || relation !== relations[peerId]?.[roleId]
          || (roleId === peerId && relation !== 0)) {
        throw new Error(`协作关系矩阵 ${roleId}→${peerId} 必须是对称的 0 或 1，且对角为 0。`);
      }
    }
  }
  if (!Number.isSafeInteger(policy.statusStaleMinutes) || policy.statusStaleMinutes < 1) {
    throw new Error('协作策略 statusStaleMinutes 必须是正整数。');
  }
  return config;
}

export function requireRole(config, roleId) {
  if (!config.roles.includes(roleId)) throw new Error(`未知角色 ${roleId}，角色集合以 agents/coordination.json 为准。`);
}

export function requireText(value, label, limit, allowEmpty = false) {
  if (typeof value !== 'string' || [...value].length > limit || (!allowEmpty && !value.trim())) {
    throw new Error(`${label}必须是最多 ${limit} 字符的文本${allowEmpty ? '' : '，且不能为空'}。`);
  }
}

export function normalizeRefs(refs) {
  if (refs.length > 3) throw new Error('引用最多 3 条仓库相对路径。');
  return refs.map(ref => {
    const normalized = ref.replaceAll('\\', '/');
    if (!normalized.trim() || /[\x00-\x1f\x7f:]/.test(normalized) || win32.isAbsolute(ref) || posix.isAbsolute(normalized)
        || normalized.split('/').includes('..')) {
      throw new Error(`引用 ${ref} 必须是仓库内的相对路径，不能是绝对路径、父目录或地址。`);
    }
    return posix.normalize(normalized);
  });
}

export function publishStatus({ roleId, state, current, needs = '', refs = [] }, repositoryRoot = sourceRoot) {
  requireRole(readCoordinationConfig(repositoryRoot), roleId);
  if (!states.includes(state)) throw new Error(`近况状态必须是 ${states.join('、')} 之一。`);
  requireText(current, '当前进展', 160);
  requireText(needs, '协作需要', 160, true);
  const normalizedRefs = normalizeRefs(refs);
  return withLocalJson(repositoryRoot, statusFileName, value => {
    const store = value ?? { roles: {} };
    const record = {
      state, current, needs, refs: normalizedRefs,
      updatedAt: new Date().toISOString(), revision: (store.roles[roleId]?.revision ?? 0) + 1,
    };
    store.roles[roleId] = record;
    return { value: store, result: { roleId, ...record } };
  });
}

// status 不带角色时返回全部角色；peers 只返回与该角色关系为 1 的角色。
export function readStatus({ command, roleId }, repositoryRoot = sourceRoot) {
  const config = readCoordinationConfig(repositoryRoot);
  if (roleId !== undefined) requireRole(config, roleId);
  const selected = command === 'peers'
    ? config.roles.filter(peerId => config.relations[roleId][peerId] === 1)
    : roleId === undefined ? config.roles : [roleId];
  const now = Date.now();
  return withLocalJson(repositoryRoot, statusFileName, value => {
    const records = value === null ? {} : value.roles;
    const briefs = selected.map(peerId => {
      const record = records[peerId];
      if (!record) return { roleId: peerId, availability: 'unknown' };
      const stale = (now - Date.parse(record.updatedAt)) / 60_000 > config.policy.statusStaleMinutes;
      return { roleId: peerId, availability: stale ? 'stale' : 'available', ...record };
    });
    return { result: command === 'peers' ? { roleId, peers: briefs } : { roles: briefs } };
  });
}

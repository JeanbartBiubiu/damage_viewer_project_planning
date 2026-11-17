import { isRecord, requireScope, withLocalJson } from './local-store.mjs';

const messageStates = ['pending', 'sending', 'sent', 'uncertain', 'failed'];
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function runtimeStore(repositoryRoot, callback) {
  return withLocalJson(repositoryRoot, 'coordination-runtime.json', value => {
    const store = value ?? { formatVersion: 1, environments: {} };
    if (!isRecord(store) || store.formatVersion !== 1 || !isRecord(store.environments)
        || Object.keys(store).length !== 2) throw new Error('协作运行登记结构无效，已保留原文件。');
    for (const [environmentId, environment] of Object.entries(store.environments)) {
      requireScope(environmentId, '运行环境');
      if (!isRecord(environment) || !isRecord(environment.actors) || !Array.isArray(environment.messages)
          || environment.messages.length > 128) throw new Error('协作运行环境结构无效，已保留原文件。');
      for (const [roleId, actor] of Object.entries(environment.actors)) {
        requireScope(roleId, '运行角色');
        if (!isRecord(actor) || typeof actor.threadId !== 'string'
            || !Number.isSafeInteger(actor.generation) || actor.generation < 1
            || !['unknown', 'running', 'idle'].includes(actor.activity)
            || !Number.isSafeInteger(actor.compactions) || actor.compactions < 0
            || !Array.isArray(actor.compactTurns) || actor.compactTurns.length > 16
            || !validDate(actor.lastEventAt)) throw new Error('角色运行记录无效，已保留原文件。');
      }
      const ids = new Set();
      for (const message of environment.messages) {
        if (!isRecord(message) || typeof message.id !== 'string' || ids.has(message.id)
            || !messageStates.includes(message.state) || typeof message.body !== 'string'
            || [...message.body].length > 12000 || typeof message.subject !== 'string' || [...message.subject].length > 160
            || typeof message.authority !== 'string' || !message.authority.trim()
            || !Number.isSafeInteger(message.attempts) || message.attempts < 0
            || !validDate(message.createdAt) || !validDate(message.updatedAt)) {
          throw new Error('角色消息记录无效，已保留原文件。');
        }
        requireScope(message.fromRoleId, '消息来源角色');
        requireScope(message.toRoleId, '消息目标角色');
        if (typeof message.taskKey !== 'string' || !message.taskKey.trim()) throw new Error('消息任务依据缺失。');
        if (['sending', 'uncertain', 'sent', 'failed'].includes(message.state)
            && (!isRecord(message.target) || typeof message.target.threadId !== 'string'
              || !Number.isSafeInteger(message.target.generation) || message.target.generation < 1
              || typeof message.dispatchToken !== 'string')) throw new Error('消息派送身份缺失，已保留原文件。');
        ids.add(message.id);
      }
    }
    return callback(store);
  });
}

export function runtimeEnvironment(store, environmentId) {
  if (!Object.hasOwn(store.environments, environmentId)) {
    store.environments[environmentId] = { actors: {}, messages: [] };
  }
  return store.environments[environmentId];
}

// 调用方已持有 sessions 锁；派送或结果不明时禁止切走目标会话。
export function assertNoActiveDelivery(repositoryRoot, environmentId, roleId) {
  return runtimeStore(repositoryRoot, store => {
    const messages = store.environments[environmentId]?.messages ?? [];
    if (messages.some(message => message.toRoleId === roleId && ['sending', 'uncertain'].includes(message.state))) {
      throw new Error('该角色存在正在派送或结果不明的消息，先核对投递结果再更换会话。');
    }
    return { result: undefined };
  });
}

import { normalizeRefs, readCoordinationConfig, requireRole, requireText } from './coordination-state.mjs';
import { rolePaths, sourceRoot, withRoleJson } from './local-store.mjs';

const decisions = ['follow_up', 'no_action', 'done'];
const immutableKeys = ['kind', 'fromRoleId', 'taskKey', 'summary', 'refs', 'attention'];

function todoStore(repositoryRoot, roleId, callback) {
  return withRoleJson(repositoryRoot, roleId, 'todo.json', value => callback(value ?? { items: [] }));
}

// 同编号同内容视为重复申报；内容不同必须换用新的任务阶段或方案版本。
function appendItem(repositoryRoot, roleId, item) {
  return todoStore(repositoryRoot, roleId, store => {
    const existing = store.items.find(entry => entry.id === item.id);
    if (existing) {
      if (immutableKeys.some(key => JSON.stringify(existing[key]) !== JSON.stringify(item[key]))) {
        throw new Error(`角色 ${roleId} 已有待办 ${item.id} 且内容不同；请在 --task 中写明新的阶段或方案版本。`);
      }
      return { result: { roleId, id: item.id, created: false } };
    }
    store.items.push(item);
    return { value: store, result: { roleId, id: item.id, created: true } };
  });
}

function newItem({ id, kind, fromRoleId, taskKey, summary, refs, attention }) {
  const now = new Date().toISOString();
  return { id, kind, fromRoleId, taskKey, summary, refs, attention, state: 'unread', decision: null, createdAt: now, updatedAt: now };
}

function requireNotice(taskKey, summary, refs) {
  requireText(taskKey, '任务阶段', 160);
  requireText(summary, '摘要', 160);
  const normalized = normalizeRefs(refs);
  if (!normalized.length) throw new Error('至少提供一条证据或方案引用。');
  return normalized;
}

// 完成申报只写关联角色的本地待办，不向任何会话发送输入。
export function completeTask({ roleId, taskKey, summary, refs = [], attentionRoles = [] }, repositoryRoot = sourceRoot) {
  const config = readCoordinationConfig(repositoryRoot);
  requireRole(config, roleId);
  const normalized = requireNotice(taskKey, summary, refs);
  const recipients = config.roles.filter(peerId => config.relations[roleId][peerId] === 1);
  const outside = attentionRoles.filter(peerId => !recipients.includes(peerId));
  if (outside.length) throw new Error(`--attention 只能指向与 ${roleId} 关系为 1 的角色：${outside.join('、')}。`);
  return {
    roleId, taskKey,
    recipients: recipients.map(peerId => appendItem(repositoryRoot, peerId, newItem({
      id: `done:${roleId}:${taskKey}`, kind: 'task_completed', fromRoleId: roleId, taskKey, summary, refs: normalized,
      attention: attentionRoles.includes(peerId) ? 'requested' : 'check',
    }))),
  };
}

// 定向通知不受关系矩阵限制，用于退回方案、提示方案就绪或给自己留待办。
export function notifyRole({ fromRoleId, toRoleId, taskKey, summary, refs = [] }, repositoryRoot = sourceRoot) {
  const config = readCoordinationConfig(repositoryRoot);
  requireRole(config, fromRoleId);
  requireRole(config, toRoleId);
  const normalized = requireNotice(taskKey, summary, refs);
  return appendItem(repositoryRoot, toRoleId, newItem({
    id: `notice:${fromRoleId}:${taskKey}`, kind: 'notice', fromRoleId, taskKey, summary, refs: normalized, attention: 'requested',
  }));
}

export function roleTodos({ roleId, includeClosed = false }, repositoryRoot = sourceRoot) {
  requireRole(readCoordinationConfig(repositoryRoot), roleId);
  const { todoPath } = rolePaths(repositoryRoot, roleId);
  return todoStore(repositoryRoot, roleId, store => ({ result: {
    roleId, todoPath,
    unread: store.items.filter(item => item.state === 'unread').length,
    followUp: store.items.filter(item => item.state === 'follow_up').length,
    items: store.items.filter(item => includeClosed || item.state !== 'closed'),
  } }));
}

export function decideTodo({ roleId, todoId, decision, note }, repositoryRoot = sourceRoot) {
  requireRole(readCoordinationConfig(repositoryRoot), roleId);
  if (!decisions.includes(decision)) throw new Error(`待办处置必须是 ${decisions.join('、')} 之一。`);
  requireText(note, '处置说明', 160);
  return todoStore(repositoryRoot, roleId, store => {
    const item = store.items.find(entry => entry.id === todoId);
    if (!item) throw new Error(`角色 ${roleId} 没有待办 ${todoId}。`);
    item.state = decision === 'follow_up' ? 'follow_up' : 'closed';
    item.decision = { kind: decision, note };
    item.updatedAt = new Date().toISOString();
    return { value: store, result: { roleId, id: item.id, state: item.state, decision: item.decision } };
  });
}

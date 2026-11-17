import { randomUUID } from 'node:crypto';
import { isRecord, requireScope, rolePaths, sourceRoot, withLocalJson, withRoleJson } from './local-store.mjs';
import { normalizeRefs, readCoordinationConfig } from './coordination-state.mjs';
import { withCurrentSession } from './session-registry.mjs';

const dateValid = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const text = (value, label, limit) => {
  if (typeof value !== 'string' || !value.trim() || [...value].length > limit || /\u0000/.test(value)) {
    throw new Error(`${label}必须是非空文本，最多 ${limit} 字符。`);
  }
};

function validateEvent(event) {
  if (!isRecord(event) || typeof event.id !== 'string'
      || typeof event.sourceThreadId !== 'string' || !Number.isSafeInteger(event.sourceGeneration)
      || event.sourceGeneration < 1 || !dateValid(event.createdAt)
      || !(event.notifiedAt === null || dateValid(event.notifiedAt))) throw new Error('完成事件身份或时间无效。');
  requireScope(event.roleId, '完成来源角色');
  text(event.taskKey, '完成任务阶段', 160);
  text(event.authority, '完成任务授权', 240);
  text(event.summary, '完成摘要', 160);
  if (!Array.isArray(event.refs) || !event.refs.length) throw new Error('完成事件必须保留证据引用。');
  normalizeRefs(event.refs);
  if (!Array.isArray(event.attentionRoles) || !Array.isArray(event.recipients) || event.recipients.length > 5
      || new Set(event.attentionRoles).size !== event.attentionRoles.length
      || new Set(event.recipients.map(item => item.roleId)).size !== event.recipients.length) {
    throw new Error('完成事件的关注角色或目标快照无效。');
  }
  for (const recipient of event.recipients) {
    requireScope(recipient.roleId, '完成通知目标');
    if (recipient.roleId === event.roleId || !['check', 'requested'].includes(recipient.attention)
        || typeof recipient.delivered !== 'boolean') throw new Error('完成通知目标快照无效。');
  }
  if (event.attentionRoles.some(roleId => !event.recipients.some(recipient => recipient.roleId === roleId))) {
    throw new Error('完成事件的关注建议不在原目标快照中。');
  }
  if ((event.notifiedAt !== null) !== event.recipients.every(recipient => recipient.delivered)) {
    throw new Error('完成事件分发进度不一致。');
  }
}

function journalStore(repositoryRoot, callback) {
  return withLocalJson(repositoryRoot, 'completion-events.json', value => {
    const store = value ?? { formatVersion: 1, environments: {} };
    if (!isRecord(store) || store.formatVersion !== 1 || !isRecord(store.environments)
        || Object.keys(store).length !== 2) throw new Error('完成事件登记结构无效，已保留原文件。');
    for (const [environmentId, events] of Object.entries(store.environments)) {
      requireScope(environmentId, '完成事件环境');
      if (!Array.isArray(events) || events.length > 512) throw new Error('完成事件列表无效。');
      const keys = new Set();
      const ids = new Set();
      for (const event of events) {
        validateEvent(event);
        const key = `${event.roleId}\0${event.taskKey}`;
        if (keys.has(key) || ids.has(event.id)) throw new Error('完成事件编号或阶段重复。');
        keys.add(key); ids.add(event.id);
      }
    }
    return callback(store);
  });
}

function todoStore(repositoryRoot, environmentId, roleId, callback) {
  return withRoleJson(repositoryRoot, environmentId, roleId, 'todo.json', value => {
    const store = value ?? { formatVersion: 1, environmentId, roleId, items: [] };
    if (!isRecord(store) || store.formatVersion !== 1 || store.environmentId !== environmentId
        || store.roleId !== roleId || !Array.isArray(store.items) || store.items.length > 512
        || Object.keys(store).length !== 4) throw new Error('角色待办结构无效，已保留原文件。');
    const ids = new Set();
    for (const item of store.items) {
      if (!isRecord(item) || typeof item.id !== 'string' || ids.has(item.id) || item.kind !== 'task_completed'
          || typeof item.eventId !== 'string' || !['check', 'requested'].includes(item.attention)
          || !['unread', 'follow_up', 'closed'].includes(item.state) || !dateValid(item.createdAt)
          || !dateValid(item.updatedAt)) throw new Error('角色待办条目无效，已保留原文件。');
      requireScope(item.fromRoleId, '待办来源');
      text(item.taskKey, '待办任务阶段', 160); text(item.summary, '待办摘要', 160);
      normalizeRefs(item.refs);
      if (item.state !== 'unread' && (!isRecord(item.decision)
          || !['follow_up', 'no_action', 'done'].includes(item.decision.kind)
          || typeof item.decision.threadId !== 'string' || !Number.isSafeInteger(item.decision.generation)
          || item.decision.generation < 1)) throw new Error('待办处置身份或结论无效。');
      if (item.state !== 'unread') text(item.decision.note, '待办处置说明', 160);
      ids.add(item.id);
    }
    const result = callback(store);
    if (value === null && !Object.hasOwn(result, 'value')) result.value = store;
    return result;
  });
}

function appendNotice(repositoryRoot, environmentId, event, recipient) {
  return todoStore(repositoryRoot, environmentId, recipient.roleId, store => {
    const id = `${event.id}:${recipient.roleId}`;
    const existing = store.items.find(item => item.id === id);
    const immutable = {
      id, kind: 'task_completed', eventId: event.id, fromRoleId: event.roleId,
      taskKey: event.taskKey, summary: event.summary, refs: event.refs,
      attention: recipient.attention, createdAt: event.createdAt,
    };
    if (existing) {
      if (Object.keys(immutable).some(key => JSON.stringify(existing[key]) !== JSON.stringify(immutable[key]))) {
        throw new Error('同编号待办内容不同，不能覆盖已有处置。');
      }
      return { result: id };
    }
    if (store.items.length >= 512) throw new Error(`角色 ${recipient.roleId} 的待办记录已达 512 条，请先归档。`);
    store.items.push({ ...immutable, state: 'unread', decision: null, updatedAt: event.createdAt });
    return { value: store, result: id };
  });
}

// 只将已声明的完成事件落到待办，不发送输入、不新建或唤醒会话。
export function flushCompletions(environmentId, repositoryRoot = sourceRoot, options = {}) {
  requireScope(environmentId, '环境');
  const limit = options.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error('完成分发每次只处理 1 至 10 个事件。');
  const selected = journalStore(repositoryRoot, store => ({ result:
    (store.environments[environmentId] ?? []).filter(event => event.notifiedAt === null
      && (!options.eventId || event.id === options.eventId)
      && (!options.sourceRoleId || event.roleId === options.sourceRoleId)).slice(0, limit)
      .map(event => ({ id: event.id, recipients: event.recipients.filter(recipient => !recipient.delivered).map(recipient => recipient.roleId) })),
  }));
  let delivered = 0;
  for (const selectedEvent of selected) {
    for (const roleId of selectedEvent.recipients) {
      const changed = journalStore(repositoryRoot, store => {
        const event = store.environments[environmentId]?.find(item => item.id === selectedEvent.id);
        if (!event) throw new Error('完成事件在分发期间消失，停止处理。');
        const recipient = event.recipients.find(item => item.roleId === roleId);
        if (!recipient || recipient.delivered) return { result: false };
        appendNotice(repositoryRoot, environmentId, event, recipient);
        recipient.delivered = true;
        if (event.recipients.every(item => item.delivered)) event.notifiedAt = new Date().toISOString();
        return { value: store, result: true };
      });
      if (changed) delivered += 1;
    }
  }
  const pending = journalStore(repositoryRoot, store => ({ result:
    (store.environments[environmentId] ?? []).filter(event => event.notifiedAt === null).length,
  }));
  return { environmentId, delivered, pending };
}

export function completeTask(request, repositoryRoot = sourceRoot) {
  const config = readCoordinationConfig(repositoryRoot);
  if (!config.roles.includes(request.roleId)) throw new Error('未知完成角色。');
  text(request.taskKey, '完成任务阶段', 160); text(request.authority, '原任务授权依据', 240);
  text(request.summary, '完成摘要', 160);
  const refs = normalizeRefs(request.refs ?? []);
  if (!refs.length) throw new Error('完成申报必须提供至少一条证据引用。');
  const attentionRoles = request.attentionRoles ?? [];
  if (!Array.isArray(attentionRoles) || new Set(attentionRoles).size !== attentionRoles.length
      || attentionRoles.some(roleId => !config.roles.includes(roleId))) throw new Error('关注建议必须是不同的有效角色。');
  const canonicalAttention = config.roles.filter(roleId => attentionRoles.includes(roleId));
  const immutable = { taskKey: request.taskKey, authority: request.authority, summary: request.summary, refs, attentionRoles: canonicalAttention };
  const accepted = withCurrentSession(request, repositoryRoot, session => journalStore(repositoryRoot, store => {
    const events = store.environments[request.environmentId] ?? [];
    const existing = events.find(event => event.roleId === request.roleId && event.taskKey === request.taskKey);
    if (existing) {
      if (Object.keys(immutable).some(key => JSON.stringify(existing[key]) !== JSON.stringify(immutable[key]))) {
        throw new Error('相同任务阶段已申报完成且内容不同，请核对原记录，不能覆盖。');
      }
      return { result: { eventId: existing.id, created: false } };
    }
    const roles = config.roles.filter(roleId => roleId !== request.roleId && config.relations[request.roleId][roleId] === 1);
    if (attentionRoles.some(roleId => !roles.includes(roleId))) throw new Error('关注建议只能指向当前有交集的其他角色。');
    if (events.length >= 512) throw new Error('完成事件已达 512 条，请先归档，不能丢弃去重记录。');
    const createdAt = new Date().toISOString();
    const event = {
      id: randomUUID(), roleId: request.roleId, sourceThreadId: session.threadId, sourceGeneration: session.generation,
      ...immutable, recipients: roles.map(roleId => ({ roleId, attention: attentionRoles.includes(roleId) ? 'requested' : 'check', delivered: false })),
      createdAt, notifiedAt: roles.length ? null : createdAt,
    };
    store.environments[request.environmentId] = [...events, event];
    return { value: store, result: { eventId: event.id, created: true } };
  }));
  try { flushCompletions(request.environmentId, repositoryRoot, { eventId: accepted.eventId }); }
  catch (error) {
    throw new Error(`完成申报已保存（${accepted.eventId}），通知尚未齐；运行 flush 重试：${error.message}`);
  }
  return journalStore(repositoryRoot, store => {
    const event = store.environments[request.environmentId].find(item => item.id === accepted.eventId);
    return { result: { ...accepted, taskKey: event.taskKey, status: event.notifiedAt ? 'notified' : 'pending',
      recipientRoles: event.recipients.map(item => item.roleId) } };
  });
}

export function roleTodos(request, repositoryRoot = sourceRoot) {
  const { environmentId, roleId } = request;
  const { todoPath } = rolePaths(repositoryRoot, environmentId, roleId);
  return todoStore(repositoryRoot, environmentId, roleId, store => ({ result: {
    environmentId, roleId, todoPath, unread: store.items.filter(item => item.state === 'unread').length,
    followUp: store.items.filter(item => item.state === 'follow_up').length,
    pending: store.items.filter(item => item.state !== 'closed').length,
    items: store.items.filter(item => request.includeClosed || item.state !== 'closed'),
  } }));
}

export function decideTodo(request, repositoryRoot = sourceRoot) {
  if (!['follow_up', 'no_action', 'done'].includes(request.decision)) throw new Error('待办判断必须是 follow_up、no_action 或 done。');
  text(request.note, '待办判断依据', 160);
  return withCurrentSession(request, repositoryRoot, session => todoStore(repositoryRoot, request.environmentId, request.roleId, store => {
    const item = store.items.find(value => value.id === request.todoId);
    if (!item) throw new Error('待办不存在。');
    if (item.state === 'closed' && item.decision.kind !== request.decision) throw new Error('已关闭待办不能被旧处理重新打开。');
    if (item.decision?.kind === request.decision && item.decision.note === request.note) {
      return { result: { id: item.id, state: item.state, decision: item.decision } };
    }
    item.state = request.decision === 'follow_up' ? 'follow_up' : 'closed';
    item.decision = { kind: request.decision, note: request.note, threadId: session.threadId, generation: session.generation };
    item.updatedAt = new Date().toISOString();
    return { value: store, result: { id: item.id, state: item.state, decision: item.decision } };
  }));
}

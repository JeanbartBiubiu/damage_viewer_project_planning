import { randomUUID } from 'node:crypto';
import { coordinationState, readCoordinationConfig } from './coordination-state.mjs';
import { isRecord, requireScope, sourceRoot } from './local-store.mjs';
import { listCurrentSessions, withCurrentSession, withSessionSnapshot } from './session-registry.mjs';
import { runtimeEnvironment, runtimeStore } from './runtime-store.mjs';
import { flushCompletions, roleTodos } from './coordination-todo.mjs';

function requireText(value, label, limit) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > limit || /\u0000/.test(value)) {
    throw new Error(`${label}必须是非空文本，最多 ${limit} 字符。`);
  }
}

function requireRole(config, roleId) {
  requireScope(roleId, '角色');
  if (!config.roles.includes(roleId)) throw new Error('目标必须是已定义的长期角色。');
}

function trimHistory(environment) {
  const ended = environment.messages.filter(message => ['sent', 'failed'].includes(message.state));
  const removed = new Set(ended.slice(0, Math.max(0, ended.length - 50)).map(message => message.id));
  environment.messages = environment.messages.filter(message => !removed.has(message.id));
}

export function requestMessage(request, repositoryRoot = sourceRoot) {
  const config = readCoordinationConfig(repositoryRoot);
  requireRole(config, request.roleId);
  requireRole(config, request.toRoleId);
  requireText(request.taskKey, '任务依据', 160);
  requireText(request.authority, '用户授权依据与范围', 240);
  requireText(request.subject, '消息摘要', 160);
  requireText(request.body, '详细消息', 12000);
  return withCurrentSession(request, repositoryRoot, session => runtimeStore(repositoryRoot, store => {
    const environment = runtimeEnvironment(store, request.environmentId);
    const existing = environment.messages.find(message => message.fromRoleId === request.roleId
      && message.toRoleId === request.toRoleId && message.taskKey === request.taskKey);
    if (existing) {
      if (existing.body !== request.body || existing.subject !== request.subject || existing.authority !== request.authority) {
        throw new Error('相同任务消息已存在，内容变化必须使用新的明确任务阶段编号。');
      }
      return { result: { id: existing.id, state: existing.state, created: false } };
    }
    trimHistory(environment);
    if (environment.messages.filter(message => !['sent', 'failed'].includes(message.state)).length >= 64) {
      throw new Error('待处理消息已达 64 条，请先收敛现有消息。');
    }
    const now = new Date().toISOString();
    const message = {
      id: randomUUID(), fromRoleId: request.roleId, sourceThreadId: session.threadId,
      sourceGeneration: session.generation, toRoleId: request.toRoleId,
      taskKey: request.taskKey, authority: request.authority, subject: request.subject, body: request.body,
      state: 'pending', target: null, dispatchToken: null, receipt: null, attempts: 0,
      createdAt: now, updatedAt: now,
    };
    environment.messages.push(message);
    return { value: store, result: { id: message.id, state: message.state, created: true } };
  }));
}

// 只形成有界派送计划。陈旧近况、生命周期事件和普通回复不生成任务。
export function wakePlan(environmentId, repositoryRoot = sourceRoot) {
  requireScope(environmentId, '环境');
  const config = readCoordinationConfig(repositoryRoot);
  // 补偿已明确申报的完成通知，只落本地待办；它们不进入会话发送计划。
  let completionRepair;
  try {
    const result = flushCompletions(environmentId, repositoryRoot);
    if (result.pending) completionRepair = { status: 'pending', ...result };
  } catch (error) {
    // 两个独立通道分别返回结果；保留本地通知故障，不阻断有效的详细派工。
    completionRepair = { status: 'failed', error: error.message };
  }
  const sessions = listCurrentSessions(repositoryRoot).filter(item => item.environmentId === environmentId);
  return runtimeStore(repositoryRoot, store => {
    const environment = store.environments[environmentId] ?? { actors: {}, messages: [] };
    const unresolved = environment.messages.filter(message => ['sending', 'uncertain'].includes(message.state))
      .map(message => ({ id: message.id, toRoleId: message.toRoleId, state: message.state, updatedAt: message.updatedAt }));
    const blockedRoles = new Set(unresolved.map(message => message.toRoleId));
    const groups = [];
    const targets = config.roles.map(roleId => ({ roleId,
      pending: environment.messages.filter(message => message.toRoleId === roleId && message.state === 'pending'),
    })).filter(target => target.pending.length && !blockedRoles.has(target.roleId))
      .sort((left, right) => Date.parse(left.pending[0].createdAt) - Date.parse(right.pending[0].createdAt));
    for (const { roleId, pending } of targets) {
      if (blockedRoles.has(roleId)) continue;
      const session = sessions.find(item => item.roleId === roleId) ?? null;
      const actor = environment.actors[roleId];
      const currentActor = session && actor?.threadId === session.threadId && actor.generation === session.generation ? actor : null;
      const ageDays = session ? (Date.now() - Date.parse(session.registeredAt)) / 86400000 : 0;
      groups.push({
        toRoleId: roleId, messageIds: pending.slice(0, 5).map(message => message.id),
        subjects: pending.slice(0, 5).map(message => ({ taskKey: message.taskKey, subject: message.subject })),
        session, activityHint: currentActor?.activity ?? 'unknown',
        rotationDue: Boolean(session && (ageDays >= config.policy.maxSessionAgeDays
          || (currentActor?.compactions ?? 0) >= config.policy.maxCompactions)),
      });
    }
    return { result: { environmentId, dispatchBudget: 1, groups, unresolved,
      ...(completionRepair ? { completionRepair } : {}),
      noAction: groups.length === 0 && unresolved.length === 0 && !completionRepair } };
  });
}

export function claimMessages(request, repositoryRoot = sourceRoot) {
  if (request.idleConfirmed !== true) throw new Error('派送前必须由环境核对真实会话未运行，不能仅凭近况领取。');
  if (!Array.isArray(request.messageIds) || request.messageIds.length < 1 || request.messageIds.length > 5
      || new Set(request.messageIds).size !== request.messageIds.length) throw new Error('每批只能领取同一角色的 1 至 5 条不同消息。');
  return withCurrentSession(request, repositoryRoot, session => runtimeStore(repositoryRoot, store => {
    const environment = runtimeEnvironment(store, request.environmentId);
    const messages = request.messageIds.map(id => environment.messages.find(message => message.id === id));
    if (messages.some(message => !message || message.toRoleId !== request.roleId || message.state !== 'pending')) {
      throw new Error('消息已被领取、目标不符或不存在，不能重复派送。');
    }
    if (environment.messages.some(message => message.toRoleId === request.roleId
        && ['sending', 'uncertain'].includes(message.state))) throw new Error('目标角色已有派送或未知结果，先核对旧结果。');
    const token = randomUUID();
    const now = new Date().toISOString();
    for (const message of messages) {
      message.state = 'sending';
      message.target = { threadId: session.threadId, hostId: session.hostId, generation: session.generation };
      message.dispatchToken = token;
      message.attempts += 1;
      message.updatedAt = now;
    }
    return { value: store, result: {
      dispatchToken: token, environmentId: request.environmentId, roleId: request.roleId,
      target: messages[0].target,
      messages: messages.map(message => ({ id: message.id, fromRoleId: message.fromRoleId,
        taskKey: message.taskKey, authority: message.authority, subject: message.subject, body: message.body })),
    } };
  }));
}

export function settleMessages(request, repositoryRoot = sourceRoot) {
  requireScope(request.environmentId, '环境');
  requireText(request.dispatchToken, '派送编号', 100);
  if (!['sent', 'not_sent', 'uncertain'].includes(request.outcome)) throw new Error('派送结果必须是 sent、not_sent 或 uncertain。');
  requireText(request.receipt, '实际投递回执或核对依据', 512);
  return withSessionSnapshot(repositoryRoot, sessions => runtimeStore(repositoryRoot, store => {
    const environment = runtimeEnvironment(store, request.environmentId);
    const messages = environment.messages.filter(message => message.dispatchToken === request.dispatchToken);
    if (!messages.length) throw new Error('未找到派送编号，不能虚构投递结果。');
    if (messages.every(message => message.state === 'sent') && request.outcome === 'sent') {
      return { result: { outcome: 'sent', messageIds: messages.map(message => message.id) } };
    }
    if (messages.every(message => message.state === 'failed') && request.outcome === 'not_sent') {
      return { result: { outcome: 'failed', messageIds: messages.map(message => message.id) } };
    }
    if (messages.some(message => !['sending', 'uncertain'].includes(message.state))) throw new Error('消息状态已变化，请先独立核对。');
    const sample = messages[0];
    const current = sessions.find(session => session.environmentId === request.environmentId && session.roleId === sample.toRoleId);
    const currentTarget = current?.threadId === sample.target.threadId && current?.generation === sample.target.generation;
    const outcome = !currentTarget && request.outcome !== 'not_sent' ? 'uncertain' : request.outcome;
    for (const message of messages) {
      message.state = outcome === 'not_sent' ? (message.attempts < 3 ? 'pending' : 'failed')
        : outcome === 'sent' ? 'sent' : 'uncertain';
      message.receipt = request.receipt;
      message.updatedAt = new Date().toISOString();
      if (message.state === 'pending') { message.target = null; message.dispatchToken = null; }
    }
    trimHistory(environment);
    return { value: store, result: { outcome: messages[0].state, messageIds: messages.map(message => message.id) } };
  }));
}

export function inspectRuntime(environmentId, repositoryRoot = sourceRoot) {
  requireScope(environmentId, '环境');
  return runtimeStore(repositoryRoot, store => {
    const environment = store.environments[environmentId] ?? { actors: {}, messages: [] };
    return { result: { environmentId, actors: environment.actors, messages: environment.messages.map(message => ({
      id: message.id, fromRoleId: message.fromRoleId, toRoleId: message.toRoleId, taskKey: message.taskKey,
      state: message.state, dispatchToken: message.dispatchToken, target: message.target,
      updatedAt: message.updatedAt, receipt: message.receipt,
    })) } };
  });
}

export function nativeHook(payload, repositoryRoot = sourceRoot) {
  if (!isRecord(payload) || typeof payload.session_id !== 'string') throw new Error('钩子事件缺少会话编号。');
  const event = payload.hook_event_name;
  if (!['SessionStart', 'UserPromptSubmit', 'PreCompact', 'PostCompact', 'Stop', 'Interrupt'].includes(event)) return {};
  // 新版输入显式标识子代理；旧输入仍须匹配此前收到的根用户轮次。
  if (payload.agent_id || payload.agent_type || payload.subagent_id || payload.parent_session_id) return {};
  const matches = listCurrentSessions(repositoryRoot).filter(item => item.threadId === payload.session_id);
  if (matches.length !== 1) return {};
  const session = matches[0];
  const config = readCoordinationConfig(repositoryRoot);
  if (!config.roles.includes(session.roleId)) return {};
  let context;
  if (event === 'SessionStart' || event === 'UserPromptSubmit') {
    const todo = roleTodos({ environmentId: session.environmentId, roleId: session.roleId }, repositoryRoot);
    const todoFile = `agents/roles/${session.roleId}/.local/${session.environmentId}/todo.json`;
    context = `你是长期角色 ${session.roleId}，环境 ${session.environmentId}，会话 ${session.threadId}，代次 ${session.generation}。先读 agents/README.md 和 agents/roles/${session.roleId}/README.md。本人待办在主检出 ${todoFile}（未读 ${todo.unread}、待跟进 ${todo.followUp}，未关闭共 ${todo.pending}）。自然接手或检查点用 todo 查看，不抢占当前任务；用 todo-ack 记下判断。完成已授权阶段并有证据时用 complete 通知关联角色，勿把通知处理当业务完成。结束前 publish 短近况，不扩大授权。`;
  }
  if (event === 'SessionStart') {
    return { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
  }
  if (typeof payload.turn_id !== 'string' || !payload.turn_id) return {};
  const eventResult = withCurrentSession(session, repositoryRoot, () => runtimeStore(repositoryRoot, store => {
    const environment = runtimeEnvironment(store, session.environmentId);
    let actor = environment.actors[session.roleId];
    if (!actor || actor.threadId !== session.threadId || actor.generation !== session.generation) {
      actor = { threadId: session.threadId, generation: session.generation, activity: 'unknown',
        activeTurnId: null, turnStartedAt: null, compactions: 0, compactTurns: [], lastEventAt: new Date().toISOString() };
    }
    if (event === 'UserPromptSubmit') {
      if (actor.activeTurnId !== payload.turn_id) {
        actor.activeTurnId = payload.turn_id;
        actor.turnStartedAt = new Date().toISOString();
      }
      actor.activity = 'running';
    } else {
      if (actor.activeTurnId !== payload.turn_id) return { result: { ignored: true } };
      if (event === 'PostCompact' && !actor.compactTurns.includes(payload.turn_id)) {
        actor.compactions += 1;
        actor.compactTurns = [...actor.compactTurns, payload.turn_id].slice(-16);
      }
      if (['Stop', 'Interrupt'].includes(event)) {
        actor.activity = 'idle';
        actor.activeTurnId = null;
      }
    }
    actor.lastEventAt = new Date().toISOString();
    environment.actors[session.roleId] = actor;
    return { value: store, result: { turnStartedAt: actor.turnStartedAt } };
  }));
  if (event === 'UserPromptSubmit') {
    return { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
  }
  if (event === 'Stop' && !eventResult.ignored) {
    flushCompletions(session.environmentId, repositoryRoot, { sourceRoleId: session.roleId, limit: 1 });
  }
  if (event === 'Stop' && !eventResult.ignored && !payload.stop_hook_active) {
    const brief = coordinationState({ command: 'status', environmentId: session.environmentId, roleId: session.roleId }, repositoryRoot).roles[0];
    if (brief.availability !== 'available' || Date.parse(brief.updatedAt) < Date.parse(eventResult.turnStartedAt)) {
      return { decision: 'block', reason: `本轮尚未发布角色 ${session.roleId} 的短近况。只需按 agents/README.md 用 publish 更新自己的当前进展与需要，随后结束；不要新开业务任务或唤醒其他角色。` };
    }
  }
  return {};
}

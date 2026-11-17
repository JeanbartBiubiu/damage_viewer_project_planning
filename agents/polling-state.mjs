import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord, localPaths, requireScope, sourceRoot, withLocalJson } from './local-store.mjs';

const fileName = 'polling.json';
const observationLimit = 30_000;
const futureTolerance = 5_000;
const observedStates = ['idle', 'running', 'needs_input', 'unknown'];
const targetKeys = ['roleId', 'threadId', 'hostId', 'generation'];
const environmentKeys = ['cursor', 'lastCycleAt', 'lastWakeAt', 'activeCycle', 'rows', 'history'];
const prompt = '请进行本轮周期自检：只读查看本人待办和近况，承接用户已授权且尚未完成的工作；无事项时用一句话结束。不自选新业务，不创建其他角色，不发送循环通知。';

function requireKeys(value, keys, label) {
  if (!isRecord(value) || Object.keys(value).length !== keys.length
      || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`${label}结构无效，字段必须完整且不能包含其他字段，已保留原文件。`);
  }
}

function requireIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value)) {
    throw new Error(`${label}必须是有效编号，不能包含空白或路径分隔符。`);
  }
}

function requireInteger(value, label, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label}必须是至少 ${minimum} 的安全整数。`);
}

function requireText(value, label, limit = 512) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > limit || /[\u0000]/.test(value)) {
    throw new Error(`${label}必须是非空文本，最多 ${limit} 字符。`);
  }
}

function requireDate(value, label, nullable = false) {
  if (nullable && value === null) return;
  const parts = typeof value === 'string'
    && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!parts || !Number.isFinite(parsed) || Number(parts[2]) > 23 || Number(parts[3]) > 59
      || Number(parts[4]) > 59 || new Date(`${parts[1]}T00:00:00Z`).toISOString().slice(0, 10) !== parts[1]) {
    throw new Error(`${label}必须是有效的 ISO 时间。`);
  }
}

function requireTarget(target) {
  requireScope(target.roleId, '轮询角色');
  requireIdentifier(target.threadId, '轮询会话');
  requireIdentifier(target.hostId, '轮询宿主');
  requireInteger(target.generation, '轮询代次');
}

function requireClaim(claim) {
  const local = isRecord(claim) && Object.hasOwn(claim, 'deliveryKind');
  requireKeys(claim, ['token', ...targetKeys, ...(local ? ['deliveryKind', 'todoId'] : [])], '轮询领取');
  requireIdentifier(claim.token, '轮询领取凭据');
  requireTarget(claim);
  if (local) {
    if (claim.deliveryKind !== 'local_todo') throw new Error('轮询本地领取的投递类型只能是 local_todo。');
    requireText(claim.todoId, '本地待办编号', 200);
  }
}

function requireClaimOutcome(claim, outcome) {
  if (claim.deliveryKind === 'local_todo' && outcome === 'sent') {
    throw new Error('本地待办领取不能结算为唤醒成功，写入确认后应延后自然接手。');
  }
  if (claim.deliveryKind !== 'local_todo' && outcome === 'deferred') {
    throw new Error('只有本地待办领取才能结算为延后自然接手。');
  }
}

function requireCheckedRoles(roles) {
  if (!Array.isArray(roles) || new Set(roles).size !== roles.length) throw new Error('轮询已检查角色必须是不重复的数组。');
  for (const roleId of roles) requireScope(roleId, '轮询已检查角色');
}

function validateStore(store) {
  requireKeys(store, ['formatVersion', 'environments'], '轮询登记');
  if (store.formatVersion !== 1 || !isRecord(store.environments)) throw new Error('轮询登记版本或环境结构无效，已保留原文件。');
  for (const [environmentId, environment] of Object.entries(store.environments)) {
    requireScope(environmentId, '轮询环境');
    requireKeys(environment, environmentKeys, '轮询环境');
    if (environment.cursor !== null) requireScope(environment.cursor, '轮询游标');
    requireDate(environment.lastCycleAt, '上次轮询时间', true);
    requireDate(environment.lastWakeAt, '上次唤醒时间', true);
    if (!isRecord(environment.rows) || !Array.isArray(environment.history) || environment.history.length > 20) {
      throw new Error('轮询角色表或周期历史结构无效，历史最多保留 20 条，已保留原文件。');
    }
    for (const [roleId, row] of Object.entries(environment.rows)) {
      requireKeys(row, ['threadId', 'hostId', 'generation', 'lastState', 'lastCheckedAt', 'lastWokenAt', 'wakeCount'], '轮询角色记录');
      requireTarget({ roleId, ...row });
      if (![...observedStates, 'stale'].includes(row.lastState)) throw new Error('轮询角色状态无效。');
      requireDate(row.lastCheckedAt, '角色检查时间', true);
      requireDate(row.lastWokenAt, '角色唤醒时间', true);
      requireInteger(row.wakeCount, '角色唤醒次数', 0);
      if (observedStates.filter(state => state !== 'unknown').includes(row.lastState) && row.lastCheckedAt === null) {
        throw new Error('已观察的轮询角色缺少检查时间。');
      }
    }
    const ids = new Set();
    for (const ended of environment.history) {
      requireKeys(ended, ['id', 'startedAt', 'endedAt', 'checkedRoles', 'claim', 'outcome', 'receipt', 'reason'], '轮询结束记录');
      requireIdentifier(ended.id, '轮询周期编号');
      requireDate(ended.startedAt, '轮询开始时间');
      requireDate(ended.endedAt, '轮询结束时间');
      requireCheckedRoles(ended.checkedRoles);
      if (ids.has(ended.id) || Date.parse(ended.endedAt) < Date.parse(ended.startedAt)) throw new Error('轮询历史编号重复或时间倒退。');
      ids.add(ended.id);
      if (ended.outcome === 'finished') {
        if (ended.claim !== null || ended.receipt !== null) throw new Error('未发送的轮询结束记录不能包含领取或回执。');
        requireText(ended.reason, '轮询结束原因');
      } else if (['sent', 'not_sent', 'deferred'].includes(ended.outcome)) {
        requireClaim(ended.claim);
        requireClaimOutcome(ended.claim, ended.outcome);
        requireText(ended.receipt, '轮询结果回执');
        if (ended.reason !== null || !ended.checkedRoles.includes(ended.claim.roleId)) throw new Error('轮询结果与检查角色不符。');
      } else throw new Error('轮询历史只能保存已结束周期。');
    }
    const active = environment.activeCycle;
    if (active !== null) {
      requireKeys(active, ['id', 'startedAt', 'phase', 'checkedRoles', 'claim', 'receipt'], '轮询活动周期');
      requireIdentifier(active.id, '轮询周期编号');
      requireDate(active.startedAt, '轮询开始时间');
      requireCheckedRoles(active.checkedRoles);
      if (ids.has(active.id) || active.startedAt !== environment.lastCycleAt) throw new Error('轮询活动周期与历史或上次周期时间冲突。');
      if (active.phase === 'checking') {
        if (active.claim !== null || active.receipt !== null) throw new Error('轮询检查阶段不能已有领取或回执。');
      } else if (['sending', 'uncertain'].includes(active.phase)) {
        requireClaim(active.claim);
        if (!active.checkedRoles.includes(active.claim.roleId)) throw new Error('轮询领取角色尚未检查。');
        if (active.phase === 'uncertain') requireText(active.receipt, '轮询未知结果回执');
        else if (active.receipt !== null) throw new Error('轮询发送阶段不能已有结果回执。');
      } else throw new Error('轮询活动阶段无效。');
    }
  }
  return store;
}

const emptyStore = () => ({ formatVersion: 1, environments: {} });
const emptyEnvironment = () => ({ cursor: null, lastCycleAt: null, lastWakeAt: null, activeCycle: null, rows: {}, history: [] });

// 查询和绑定守卫不创建目录、登记或锁；文件替换由共享存储保证完整。
function readStore(repositoryRoot) {
  const path = join(localPaths(repositoryRoot).localDirectory, fileName);
  let content;
  try { content = readFileSync(path, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return emptyStore();
    throw error;
  }
  let value;
  try { value = JSON.parse(content); }
  catch { throw new Error('轮询登记不是有效 JSON，已保留原文件。'); }
  return validateStore(value);
}

function readConfig(repositoryRoot) {
  let config;
  try { config = JSON.parse(readFileSync(join(repositoryRoot, 'agents', 'coordination.json'), 'utf8')); }
  catch (error) { throw new Error('无法读取协作配置，请核对 agents/coordination.json 及 JSON 格式。', { cause: error }); }
  requireKeys(config, ['formatVersion', 'roles', 'relations', 'policy'], '协作配置');
  if (config.formatVersion !== 1 || !Array.isArray(config.roles) || !config.roles.length
      || new Set(config.roles).size !== config.roles.length || !isRecord(config.relations)) {
    throw new Error('轮询所需的协作配置角色或版本无效。');
  }
  for (const roleId of config.roles) requireScope(roleId, '配置角色');
  // 完整策略由协作配置入口统一校验；这里只读取轮询自身需要的间隔。
  if (!isRecord(config.policy)) throw new Error('轮询所需的协作策略结构无效。');
  requireInteger(config.policy.wakeEveryMinutes, '轮询间隔');
  if (!Number.isSafeInteger(config.policy.wakeEveryMinutes * 60_000)) throw new Error('轮询间隔超出安全整数范围。');
  return config;
}

function currentSessions(sessions, environmentId, roles) {
  if (!Array.isArray(sessions)) throw new Error('轮询必须接收调用方持锁取得的真实会话登记数组。');
  const current = new Map();
  const seen = new Set();
  for (const session of sessions) {
    requireKeys(session, ['environmentId', ...targetKeys, 'registeredAt'], '轮询会话快照');
    requireScope(session.environmentId, '会话快照环境');
    requireTarget(session);
    requireDate(session.registeredAt, '会话登记时间');
    const key = `${session.environmentId}/${session.roleId}`;
    if (seen.has(key)) throw new Error('会话快照包含重复的环境角色登记。');
    seen.add(key);
    if (session.environmentId === environmentId && roles.includes(session.roleId)) current.set(session.roleId, session);
  }
  return current;
}

const sameBinding = (left, right) => Boolean(left && right && left.threadId === right.threadId
  && left.hostId === right.hostId && left.generation === right.generation);
const targetOf = session => Object.fromEntries(targetKeys.map(key => [key, session[key]]));

function synchronize(environment, current, roles) {
  const rows = {};
  for (const roleId of roles) {
    const session = current.get(roleId);
    if (!session) continue;
    const previous = Object.hasOwn(environment.rows, roleId) ? environment.rows[roleId] : null;
    rows[roleId] = sameBinding(previous, session) ? previous : {
      threadId: session.threadId, hostId: session.hostId, generation: session.generation,
      lastState: previous ? 'stale' : 'unknown', lastCheckedAt: null,
      lastWokenAt: previous?.lastWokenAt ?? null, wakeCount: previous?.wakeCount ?? 0,
    };
  }
  environment.rows = rows;
  if (environment.cursor !== null && !current.has(environment.cursor)) {
    const start = roles.indexOf(environment.cursor);
    environment.cursor = roles.slice(start + 1).concat(roles.slice(0, start + 1)).find(roleId => current.has(roleId)) ?? null;
  }
}

// 游标保存下一待检查角色；未登记角色不会进入候选，更不会创建会话。
function candidates(environment, current, roles) {
  const start = Math.max(0, roles.indexOf(environment.cursor));
  return roles.slice(start).concat(roles.slice(0, start))
    .filter(roleId => current.has(roleId) && !environment.activeCycle.checkedRoles.includes(roleId))
    .map(roleId => targetOf(current.get(roleId)));
}

function advanceCursor(environment, roleId, current, roles) {
  const start = roles.indexOf(roleId) + 1;
  environment.cursor = roles.slice(start).concat(roles.slice(0, start)).find(next => current.has(next)) ?? null;
}

function requireActive(environment, cycleId, phase) {
  const active = environment.activeCycle;
  if (!active || active.id !== cycleId) throw new Error('轮询周期不存在或已变化。');
  if (phase && active.phase !== phase) throw new Error('轮询周期已领取或结果不明，不能继续检查或领取。');
  return active;
}

function endCycle(environment, active, now, outcome, receipt = null, reason = null) {
  environment.history.push({ id: active.id, startedAt: active.startedAt, endedAt: now,
    checkedRoles: active.checkedRoles, claim: active.claim, outcome, receipt, reason });
  environment.history = environment.history.slice(-20);
  environment.activeCycle = null;
}

function validateRequest(request, roles) {
  const fields = {
    begin: [], status: [],
    observe: ['cycleId', 'roleId', 'threadId', 'generation', 'state', 'observedAt'],
    claim: ['cycleId', 'roleId', 'threadId', 'generation'],
    'claim-local': ['cycleId', 'roleId', 'threadId', 'generation', 'todoId'],
    settle: ['cycleId', 'token', 'outcome', 'receipt'],
    finish: ['cycleId', 'reason'],
  };
  if (!isRecord(request) || !Object.hasOwn(fields, request.command)) throw new Error('轮询命令必须是 begin、status、observe、claim、claim-local、settle 或 finish。');
  requireKeys(request, ['command', 'environmentId', ...fields[request.command]], '轮询命令');
  requireScope(request.environmentId, '轮询环境');
  if (Object.hasOwn(request, 'cycleId')) requireIdentifier(request.cycleId, '轮询周期编号');
  if (Object.hasOwn(request, 'roleId')) {
    requireScope(request.roleId, '轮询角色');
    if (!roles.includes(request.roleId)) throw new Error('轮询目标不是协作配置中的已知角色。');
    requireIdentifier(request.threadId, '轮询会话');
    requireInteger(request.generation, '轮询代次');
  }
  if (request.command === 'observe') {
    if (!observedStates.includes(request.state)) throw new Error('实际观察状态只能是 idle、running、needs_input 或 unknown。');
    requireDate(request.observedAt, '实际观察时间');
  }
  if (request.command === 'claim-local') requireText(request.todoId, '本地待办编号', 200);
  if (request.command === 'settle') {
    requireIdentifier(request.token, '轮询领取凭据');
    if (!['sent', 'not_sent', 'uncertain', 'deferred'].includes(request.outcome)) throw new Error('轮询结果只能是 sent、not_sent、uncertain 或 deferred。');
    requireText(request.receipt, '实际投递回执或核对依据');
  }
  if (request.command === 'finish') requireText(request.reason, '轮询结束原因');
}

// 调用方持有会话快照锁直到同步返回；本模块只管理状态，不调用模型或发送工具。
export function pollingState(request, sessions, repositoryRoot = sourceRoot) {
  const config = readConfig(repositoryRoot);
  validateRequest(request, config.roles);
  const current = currentSessions(sessions, request.environmentId, config.roles);
  if (request.command === 'status') {
    const store = readStore(repositoryRoot);
    const environment = Object.hasOwn(store.environments, request.environmentId)
      ? store.environments[request.environmentId] : emptyEnvironment();
    return { environmentId: request.environmentId, ...environment };
  }
  return withLocalJson(repositoryRoot, fileName, value => {
    const store = value === null ? emptyStore() : validateStore(value);
    let environment = Object.hasOwn(store.environments, request.environmentId) ? store.environments[request.environmentId] : null;
    if (!environment) {
      if (request.command !== 'begin') throw new Error('轮询环境尚未开始周期。');
      environment = emptyEnvironment();
      store.environments[request.environmentId] = environment;
    }
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const save = result => ({ value: validateStore(store), result });
    if (request.command === 'begin') {
      synchronize(environment, current, config.roles);
      let active = environment.activeCycle;
      if (active && active.phase !== 'checking') {
        return save({ status: 'needs_reconcile', cycleId: active.id, candidates: [], claim: active.claim });
      }
      if (!active) {
        const anchors = [environment.lastCycleAt, environment.lastWakeAt, environment.history.at(-1)?.endedAt ?? null]
          .filter(value => value !== null);
        const until = anchors.length === 0 ? null
          : Math.max(...anchors.map(value => Date.parse(value))) + config.policy.wakeEveryMinutes * 60_000;
        if (until !== null && nowMs < until) return save({ status: 'cooldown', candidates: [], cooldownUntil: new Date(until).toISOString() });
        active = { id: randomUUID(), startedAt: now, phase: 'checking', checkedRoles: [], claim: null, receipt: null };
        environment.activeCycle = active;
        environment.lastCycleAt = now;
      }
      return save({ status: 'ready', cycleId: active.id, candidates: candidates(environment, current, config.roles) });
    }
    if (request.command === 'observe') {
      const active = requireActive(environment, request.cycleId, 'checking');
      const observedMs = Date.parse(request.observedAt);
      if (nowMs - observedMs > observationLimit || observedMs - nowMs > futureTolerance) {
        throw new Error('实际观察已过期或超过未来 5 秒，必须重新读取真实会话。');
      }
      const previous = Object.hasOwn(environment.rows, request.roleId) ? environment.rows[request.roleId] : null;
      if (previous?.lastCheckedAt !== null && previous?.lastCheckedAt !== undefined
          && observedMs < Date.parse(previous.lastCheckedAt)) throw new Error('实际观察早于已记录的观察，不能倒退覆盖。');
      synchronize(environment, current, config.roles);
      const session = current.get(request.roleId);
      const matched = session?.threadId === request.threadId && session?.generation === request.generation;
      const state = matched ? request.state : 'stale';
      if (session) Object.assign(environment.rows[request.roleId], { lastState: state, lastCheckedAt: request.observedAt });
      if (!active.checkedRoles.includes(request.roleId)) active.checkedRoles.push(request.roleId);
      advanceCursor(environment, request.roleId, current, config.roles);
      return save({ cycleId: active.id, roleId: request.roleId, state, eligible: matched && state === 'idle' });
    }
    if (request.command === 'claim' || request.command === 'claim-local') {
      const active = requireActive(environment, request.cycleId, 'checking');
      const session = current.get(request.roleId);
      const row = Object.hasOwn(environment.rows, request.roleId) ? environment.rows[request.roleId] : null;
      if (!session || session.threadId !== request.threadId || session.generation !== request.generation
          || !sameBinding(row, session)) throw new Error('轮询角色未绑定或会话代次已变化，不能领取。');
      const age = row.lastCheckedAt === null ? Infinity : nowMs - Date.parse(row.lastCheckedAt);
      if (active.claim !== null || !active.checkedRoles.includes(request.roleId) || row.lastState !== 'idle'
          || age > observationLimit || age < -futureTolerance) {
        throw new Error('领取必须依据本轮 30 秒内记录的真实空闲观察，且本轮尚未领取。');
      }
      active.claim = { token: randomUUID(), ...targetOf(session) };
      const local = request.command === 'claim-local';
      if (local) Object.assign(active.claim, { deliveryKind: 'local_todo', todoId: request.todoId });
      active.phase = 'sending';
      return save({ cycleId: active.id, token: active.claim.token, target: targetOf(session), prompt,
        ...(local ? { todoId: request.todoId } : {}) });
    }
    if (request.command === 'settle') {
      const result = { cycleId: request.cycleId, outcome: request.outcome, receipt: request.receipt };
      const ended = environment.history.find(item => item.id === request.cycleId);
      if (ended) {
        if (!ended.claim || ended.claim.token !== request.token) throw new Error('轮询领取凭据不符，不能结算。');
        requireClaimOutcome(ended.claim, request.outcome);
        if (ended.outcome !== request.outcome || ended.receipt !== request.receipt) throw new Error('轮询周期已结束，不能改写终结回执。');
        return { result };
      }
      const active = requireActive(environment, request.cycleId);
      if (!active.claim || active.claim.token !== request.token || !['sending', 'uncertain'].includes(active.phase)) {
        throw new Error('轮询领取凭据不符或尚未领取，不能结算。');
      }
      requireClaimOutcome(active.claim, request.outcome);
      if (request.outcome === 'uncertain') {
        if (active.phase === 'uncertain' && active.receipt === request.receipt) return { result };
        active.phase = 'uncertain';
        active.receipt = request.receipt;
      } else {
        if (request.outcome === 'sent') {
          environment.lastWakeAt = now;
          const row = Object.hasOwn(environment.rows, active.claim.roleId) ? environment.rows[active.claim.roleId] : null;
          if (row) {
            requireInteger(row.wakeCount + 1, '角色唤醒次数');
            row.lastWokenAt = now;
            row.wakeCount += 1;
          }
        }
        endCycle(environment, active, now, request.outcome, request.receipt);
      }
      return save(result);
    }
    const active = requireActive(environment, request.cycleId, 'checking');
    if (active.claim !== null) throw new Error('已有领取的轮询周期不能直接结束。');
    endCycle(environment, active, now, 'finished', null, request.reason);
    return save({ cycleId: active.id, outcome: 'finished', reason: request.reason });
  });
}

// 调用方已持会话锁；检查阶段不锁定角色，发送及未知结果只锁定领取目标。
export function assertNoActivePolling(repositoryRoot, environmentId, roleId) {
  requireScope(environmentId, '轮询环境');
  requireScope(roleId, '轮询角色');
  const store = readStore(repositoryRoot);
  const environment = Object.hasOwn(store.environments, environmentId) ? store.environments[environmentId] : null;
  const active = environment?.activeCycle;
  if (active && ['sending', 'uncertain'].includes(active.phase) && active.claim.roleId === roleId) {
    throw new Error('该角色存在正在发送或结果不明的轮询唤醒，先核对真实结果再更换会话。');
  }
}

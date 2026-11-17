import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { coordinationState, readCoordinationConfig } from './coordination-state.mjs';
import { localPaths, sourceRoot, withLocalJson } from './local-store.mjs';
import { claimMessages, inspectRuntime, requestMessage, settleMessages, wakePlan } from './coordination-runtime.mjs';
import { completeTask, decideTodo, flushCompletions, queuePeriodicCheck, roleTodos } from './coordination-todo.mjs';
import { environmentBootstrap } from './environment-bootstrap.mjs';
import { pollingState } from './polling-state.mjs';
import { sessionRegistry, withSessionSnapshot } from './session-registry.mjs';

export function coordinationCommand(argv, repositoryRoot = sourceRoot) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      environment: { type: 'string' }, 'thread-id': { type: 'string' }, generation: { type: 'string' },
      state: { type: 'string' }, current: { type: 'string' }, needs: { type: 'string' },
      ref: { type: 'string', multiple: true }, from: { type: 'string' }, task: { type: 'string' },
      authority: { type: 'string' }, subject: { type: 'string' }, 'body-file': { type: 'string' },
      'idle-confirmed': { type: 'boolean' }, token: { type: 'string' }, outcome: { type: 'string' },
      receipt: { type: 'string' },
      summary: { type: 'string' }, attention: { type: 'string', multiple: true },
      decision: { type: 'string' }, note: { type: 'string' }, all: { type: 'boolean' },
      cycle: { type: 'string' }, 'observed-at': { type: 'string' }, reason: { type: 'string' },
      'automation-id': { type: 'string' }, 'target-thread-id': { type: 'string' },
      'native-status': { type: 'string' }, 'expected-id': { type: 'string' },
      'expected-revision': { type: 'string' },
      'native-absent': { type: 'boolean' }, attempt: { type: 'string' },
    },
  });
  const [command, roleId, ...extra] = positionals;
  const optionSets = {
    matrix: [], status: ['environment'], peers: ['environment'],
    publish: ['environment', 'thread-id', 'generation', 'state', 'current', 'needs', 'ref'],
    request: ['environment', 'thread-id', 'generation', 'from', 'task', 'authority', 'subject', 'body-file'],
    tick: ['environment'], runtime: ['environment'],
    claim: ['environment', 'thread-id', 'generation', 'idle-confirmed'],
    settle: ['environment', 'token', 'outcome', 'receipt'],
    complete: ['environment', 'thread-id', 'generation', 'task', 'authority', 'summary', 'ref', 'attention'],
    todo: ['environment', 'all'],
    'todo-ack': ['environment', 'thread-id', 'generation', 'decision', 'note'],
    flush: ['environment'],
    bootstrap: ['environment'],
    'bootstrap-create': ['environment', 'expected-id', 'expected-revision', 'native-absent'],
    'bootstrap-bind': ['environment', 'expected-id', 'expected-revision', 'automation-id', 'target-thread-id', 'native-status', 'attempt'],
    'bootstrap-result': ['environment', 'expected-revision', 'attempt', 'outcome', 'receipt'],
    'poll-begin': ['environment'], 'poll-status': ['environment'],
    'poll-observe': ['environment', 'cycle', 'thread-id', 'generation', 'state', 'observed-at'],
    'poll-claim': ['environment', 'cycle', 'thread-id', 'generation'],
    'poll-defer': ['environment', 'cycle', 'thread-id', 'generation'],
    'poll-settle': ['environment', 'cycle', 'token', 'outcome', 'receipt'],
    'poll-finish': ['environment', 'cycle', 'reason'],
  };
  if (!Object.hasOwn(optionSets, command) || Object.keys(values).some(key => !optionSets[command].includes(key))) {
    throw new Error('未知命令或参数不属于该命令，请查看 agents/README.md。');
  }
  if (['matrix', 'tick', 'runtime', 'settle', 'flush', 'bootstrap', 'bootstrap-create', 'bootstrap-bind',
    'bootstrap-result', 'poll-begin', 'poll-status', 'poll-settle', 'poll-finish'].includes(command)
      && roleId !== undefined) throw new Error('该命令不接受角色位置参数。');
  if (!['claim', 'todo-ack'].includes(command) && extra.length) throw new Error('位置参数过多。');
  const environmentId = values.environment;
  const identity = () => {
    if (!/^[1-9][0-9]*$/.test(values.generation ?? '') || !Number.isSafeInteger(Number(values.generation))) {
      throw new Error('必须提供 --generation 当前正整数代次。');
    }
    return { environmentId, roleId, threadId: values['thread-id'], generation: Number(values.generation) };
  };
  if (command === 'bootstrap') {
    const automation = environmentBootstrap({ command: 'check', environmentId }, repositoryRoot);
    sessionRegistry({ command: 'init' }, repositoryRoot);
    withLocalJson(repositoryRoot, 'polling.json', value => value === null
      ? { value: { formatVersion: 1, environments: {} }, result: null } : { result: null });
    const polling = withSessionSnapshot(repositoryRoot, sessions => pollingState({ command: 'status', environmentId }, sessions, repositoryRoot));
    return { automation, polling };
  }
  if (['bootstrap-create', 'bootstrap-bind', 'bootstrap-result'].includes(command)) {
    if (command !== 'bootstrap-result' && !Object.hasOwn(values, 'expected-id')) throw new Error('必须提供 --expected-id，首次使用 none。');
    if (!/^(0|[1-9][0-9]*)$/.test(values['expected-revision'] ?? '')
        || !Number.isSafeInteger(Number(values['expected-revision']))) throw new Error('必须提供 --expected-revision 当前非负整数修订号。');
    return environmentBootstrap({ command: command === 'bootstrap-create' ? 'begin-create' : command === 'bootstrap-bind' ? 'bind' : 'creation-result',
      environmentId, expectedAutomationId: values['expected-id'] === 'none' ? null : values['expected-id'],
      expectedRevision: Number(values['expected-revision']),
      nativeAbsenceConfirmed: values['native-absent'] === true, automationId: values['automation-id'],
      targetThreadId: values['target-thread-id'], status: values['native-status'], attemptId: values.attempt,
      outcome: values.outcome, receipt: values.receipt }, repositoryRoot);
  }
  if (command.startsWith('poll-')) {
    readCoordinationConfig(repositoryRoot);
    if (command === 'poll-claim' && readCoordinationConfig(repositoryRoot).policy.pollingMode !== 'idle_recheck') {
      throw new Error('当前为 observe_only，仅记录轮询，不允许向角色发送唤醒输入。');
    }
    if (command === 'poll-defer') {
      const target = identity();
      return withSessionSnapshot(repositoryRoot, sessions => {
        const todos = roleTodos({ environmentId, roleId }, repositoryRoot);
        const pending = todos.items.find(item => item.kind === 'periodic_check');
        const todoId = pending?.id ?? `poll:${values.cycle}:${roleId}`;
        const claimed = pollingState({ command: 'claim-local', ...target, cycleId: values.cycle, todoId }, sessions, repositoryRoot);
        let queued;
        try { queued = queuePeriodicCheck({ environmentId, roleId, cycleId: values.cycle, todoId }, repositoryRoot); }
        catch (error) {
          pollingState({ command: 'settle', environmentId, cycleId: values.cycle, token: claimed.token,
            outcome: 'uncertain', receipt: `本地待办落盘结果需核对：${error.message}`.slice(0, 512) }, sessions, repositoryRoot);
          throw new Error(`周期待办登记未确认，请按轮询记录核对 ${todoId}；未发送任何会话输入。`);
        }
        pollingState({ command: 'settle', environmentId, cycleId: values.cycle, token: claimed.token,
          outcome: 'deferred', receipt: `已登记或复用本地待办 ${queued.id}，未发送会话输入` }, sessions, repositoryRoot);
        return { cycleId: values.cycle, roleId, ...queued, outcome: 'deferred' };
      });
    }
    let pollRequest = { command: command.slice(5), environmentId };
    if (['poll-observe', 'poll-claim'].includes(command)) pollRequest = { ...pollRequest, ...identity(), cycleId: values.cycle };
    if (command === 'poll-observe') Object.assign(pollRequest, { state: values.state, observedAt: values['observed-at'] });
    if (command === 'poll-settle') Object.assign(pollRequest, { cycleId: values.cycle, token: values.token,
      outcome: values.outcome, receipt: values.receipt });
    if (command === 'poll-finish') Object.assign(pollRequest, { cycleId: values.cycle, reason: values.reason });
    return withSessionSnapshot(repositoryRoot, sessions => pollingState(pollRequest, sessions, repositoryRoot));
  }
  if (command === 'matrix') return readCoordinationConfig(repositoryRoot);
  if (command === 'complete') return completeTask({ ...identity(), taskKey: values.task,
    authority: values.authority, summary: values.summary, refs: values.ref ?? [], attentionRoles: values.attention ?? [] }, repositoryRoot);
  if (command === 'todo') return roleTodos({ environmentId, roleId, includeClosed: values.all === true }, repositoryRoot);
  if (command === 'todo-ack') {
    if (extra.length !== 1) throw new Error('todo-ack 必须指定一条待办编号。');
    return decideTodo({ ...identity(), todoId: extra[0], decision: values.decision, note: values.note }, repositoryRoot);
  }
  if (command === 'flush') return flushCompletions(environmentId, repositoryRoot);
  if (['status', 'peers'].includes(command)) {
    return coordinationState({ command, environmentId, ...(roleId === undefined ? {} : { roleId }) }, repositoryRoot);
  }
  if (command === 'publish') {
    return coordinationState({ command, ...identity(), state: values.state, current: values.current,
      needs: values.needs ?? '', refs: values.ref ?? [] }, repositoryRoot);
  }
  if (command === 'request') {
    if (!values['body-file']) throw new Error('详细消息必须通过 --body-file 指定本地 UTF-8 文本文件。');
    const sender = { ...identity(), roleId: values.from };
    const { mainRoot, localDirectory } = localPaths(repositoryRoot);
    const expectedDirectory = resolve(realpathSync(mainRoot), 'agents', '.local', 'messages');
    const messageDirectory = realpathSync(resolve(localDirectory, 'messages'));
    if (relative(expectedDirectory, messageDirectory) !== '') {
      throw new Error('详细消息目录必须位于主检出的 agents/.local/messages/，不能通过目录联接转发其他位置。');
    }
    const bodyPath = realpathSync(resolve(mainRoot, values['body-file']));
    const messageRelative = relative(messageDirectory, bodyPath);
    if (!messageRelative || messageRelative.startsWith('..') || isAbsolute(messageRelative)) {
      throw new Error('详细消息文件必须在主检出的 agents/.local/messages/ 内，不能转发其他本地文件。');
    }
    const bytes = readFileSync(bodyPath);
    if (bytes.length > 48000) throw new Error('详细消息文件超过 48000 字节。');
    return requestMessage({ ...sender, toRoleId: roleId, taskKey: values.task, authority: values.authority,
      subject: values.subject, body: bytes.toString('utf8') }, repositoryRoot);
  }
  if (command === 'tick') return wakePlan(environmentId, repositoryRoot);
  if (command === 'runtime') return inspectRuntime(environmentId, repositoryRoot);
  if (command === 'claim') {
    const config = readCoordinationConfig(repositoryRoot);
    const targetRoleId = values['thread-id'] && config.roles.find(item => item === roleId);
    if (!targetRoleId || !extra.length) throw new Error('claim 用法：claim <目标角色> <消息编号...>，并提供当前会话与代次。');
    return claimMessages({ ...identity(), messageIds: extra, idleConfirmed: values['idle-confirmed'] === true }, repositoryRoot);
  }
  return settleMessages({ environmentId, dispatchToken: values.token, outcome: values.outcome, receipt: values.receipt }, repositoryRoot);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(coordinationCommand(process.argv.slice(2)), null, 2)}\n`); }
  catch (error) { process.stderr.write(`角色协作失败：${error.message}\n`); process.exitCode = 1; }
}

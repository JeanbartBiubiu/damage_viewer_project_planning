import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { publishStatus, readCoordinationConfig, readStatus } from './coordination-state.mjs';
import { completeTask, decideTodo, notifyRole, roleTodos } from './coordination-todo.mjs';
import { sourceRoot } from './local-store.mjs';
import { bindRole, resolveRole } from './session-registry.mjs';

// 每个命令允许的选项及位置参数个数（第一个位置参数是命令名）。
const commands = {
  matrix: { options: [], positionals: [0] },
  resolve: { options: [], positionals: [1] },
  bind: { options: ['tool', 'session-id'], positionals: [1] },
  status: { options: [], positionals: [0, 1] },
  peers: { options: [], positionals: [1] },
  publish: { options: ['state', 'current', 'needs', 'ref'], positionals: [1] },
  complete: { options: ['task', 'summary', 'ref', 'attention'], positionals: [1] },
  notify: { options: ['from', 'task', 'summary', 'ref'], positionals: [1] },
  todo: { options: ['all'], positionals: [1] },
  'todo-ack': { options: ['decision', 'note'], positionals: [2] },
};

export function coordinationCommand(argv, repositoryRoot = sourceRoot) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      tool: { type: 'string' }, 'session-id': { type: 'string' },
      state: { type: 'string' }, current: { type: 'string' }, needs: { type: 'string' },
      ref: { type: 'string', multiple: true }, attention: { type: 'string', multiple: true },
      from: { type: 'string' }, task: { type: 'string' }, summary: { type: 'string' },
      decision: { type: 'string' }, note: { type: 'string' }, all: { type: 'boolean' },
    },
  });
  const [command, roleId, todoId] = positionals;
  const spec = commands[command];
  if (!spec || Object.keys(values).some(key => !spec.options.includes(key))
      || !spec.positionals.includes(positionals.length - 1)) {
    throw new Error('未知命令、参数不属于该命令或位置参数个数不对，请查看 agents/README.md。');
  }
  switch (command) {
    case 'matrix': return readCoordinationConfig(repositoryRoot);
    case 'resolve': return resolveRole(roleId, repositoryRoot);
    case 'bind': return bindRole({ roleId, tool: values.tool, sessionId: values['session-id'] }, repositoryRoot);
    case 'status':
    case 'peers': return readStatus({ command, roleId }, repositoryRoot);
    case 'publish': return publishStatus({ roleId, state: values.state, current: values.current,
      needs: values.needs, refs: values.ref }, repositoryRoot);
    case 'complete': return completeTask({ roleId, taskKey: values.task, summary: values.summary,
      refs: values.ref, attentionRoles: values.attention }, repositoryRoot);
    case 'notify': return notifyRole({ fromRoleId: values.from, toRoleId: roleId, taskKey: values.task,
      summary: values.summary, refs: values.ref }, repositoryRoot);
    case 'todo': return roleTodos({ roleId, includeClosed: values.all }, repositoryRoot);
    default: return decideTodo({ roleId, todoId, decision: values.decision, note: values.note }, repositoryRoot);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(coordinationCommand(process.argv.slice(2)), null, 2)}\n`); }
  catch (error) { process.stderr.write(`角色协作失败：${error.message}\n`); process.exitCode = 1; }
}

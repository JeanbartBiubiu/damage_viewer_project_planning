import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roleTodos } from './coordination-todo.mjs';
import { sourceRoot } from './local-store.mjs';
import { findRoleBySession } from './session-registry.mjs';

// 其他工作树的旧钩子配置会投递任意事件；只有已登记角色根会话的 SessionStart 返回上下文，其余一律返回空对象。
export function hookOutput(payload, repositoryRoot = sourceRoot) {
  if (payload.hook_event_name !== 'SessionStart'
      || payload.agent_id || payload.agent_type || payload.subagent_id || payload.parent_session_id) return {};
  const roleId = findRoleBySession(payload.session_id, repositoryRoot);
  if (!roleId) return {};
  const { unread, followUp } = roleTodos({ roleId }, repositoryRoot);
  const local = `agents/roles/${roleId}/.local`;
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext:
    `你是长期角色 ${roleId}。先读 agents/README.md 与 agents/roles/${roleId}/README.md。主检出 ${local}/todo.json 有未读待办 ${unread} 条、待跟进 ${followUp} 条，笔记在 ${local}/memory.md。在检查点用 todo 查看，交接前自己 publish 近况，不扩大授权。`,
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try { process.stdout.write(`${JSON.stringify(hookOutput(JSON.parse(Buffer.concat(chunks).toString('utf8'))))}\n`); }
  catch (error) { process.stderr.write(`协作钩子失败：${error.message}\n`); process.exitCode = 1; }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coordinationCommand } from './coordination.mjs';
import { sourceRoot } from './local-store.mjs';
import { fixture } from './test-fixture.mjs';

const hooks = JSON.parse(readFileSync(join(sourceRoot, '.codex', 'hooks.json'), 'utf8')).hooks;

function runConfiguredHook(root, payload) {
  const result = spawnSync(hooks.SessionStart[0].hooks[0].command, {
    cwd: root, input: JSON.stringify(payload), encoding: 'utf8', shell: true, windowsHide: true, timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('项目钩子只登记 SessionStart', () => {
  assert.deepEqual(Object.keys(hooks), ['SessionStart']);
});

test('已登记角色的根会话在启动时获得角色与待办提示，其他事件和会话得到空对象', t => {
  const root = fixture(t, { copyScripts: true });
  coordinationCommand(['bind', 'manager', '--tool', 'codex', '--session-id', 'session-manager'], root);
  coordinationCommand(['notify', 'manager', '--from', 'planner', '--task', 'plan@v1', '--summary', '方案就绪', '--ref', '文档记录/方案/plan.md'], root);
  const started = runConfiguredHook(root, { session_id: 'session-manager', hook_event_name: 'SessionStart', source: 'startup' });
  const context = started.hookSpecificOutput.additionalContext;
  assert.equal(started.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(context, /长期角色 manager/);
  assert.match(context, /未读待办 1 条/);
  assert.ok(context.length <= 512);
  for (const event of ['UserPromptSubmit', 'PreCompact', 'PostCompact', 'Stop', 'Interrupt']) {
    assert.deepEqual(runConfiguredHook(root, { session_id: 'session-manager', hook_event_name: event, turn_id: 'turn-1' }), {}, event);
  }
  assert.deepEqual(runConfiguredHook(root, { session_id: 'unknown', hook_event_name: 'SessionStart' }), {});
  assert.deepEqual(runConfiguredHook(root, { session_id: 'session-manager', hook_event_name: 'SessionStart', agent_id: 'child' }), {});
});

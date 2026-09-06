import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

// 页面完成四条引爆规则转换后，按已核对依赖删除 W 的旧投影。
assert.equal(process.argv[2], '--apply', '仅在浏览器转换完成后以 --apply 执行');
const base = 'http://127.0.0.1:8080/api/admin/games/lol/skills/ez_w';
const output = new URL('../../output/authoring-simplification/', import.meta.url);
const snapshot = JSON.parse(await fs.readFile(new URL('before-lifecycle.json', output), 'utf8')).skills.ez_w;
assert.ok((await fs.stat(new URL('test0221-before-lifecycle-20260906.dump', output))).size > 0, '缺少调整前完整备份');
const events = [];
async function call(method, path, expected = 200) {
  const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer local-aggregate-acceptance-placeholder' } });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${text}`);
  events.push({ method, path, status: response.status });
  return text ? JSON.parse(text) : null;
}
for (const suffix of ['basic_attack', 'ez_q', 'ez_e', 'ez_r']) {
  const rule = await call('GET', `/trigger-rules/detonate_private_mark_on_${suffix}_hit`);
  const conditions = rule.conditionGroups.flatMap(group => group.conditions);
  assert.ok(conditions.some(condition => condition.conditionType === 'LIFECYCLE_CHECK'
    && condition.detail.effectKey === 'essence_flux_mark' && condition.detail.subject === 'CURRENT_TARGET'
    && condition.detail.checkKind === 'PRESENT'), '引爆规则尚未读取当前目标生命周期');
  assert.ok(!conditions.some(condition => condition.conditionType === 'INTERNAL_STATE_CHECK'
    && condition.detail.stateKey === 'essence_flux_mark_active'), '仍在读取旧投影计数');
  assert.ok(!rule.actions.some(action => action.actionType === 'START_PROCESS' && action.detail.processKey === 'clear_mark'), '仍在执行清零过程');
  assert.ok(rule.actions.some(action => action.actionType === 'EXECUTE_EFFECT'
    && action.detail.effectKey === (suffix === 'basic_attack' ? 'detonate_by_attack' : 'detonate_by_skill')), '引爆效果缺失');
}
const targets = [
  ['trigger-rules', 'ruleKey', 'sync_mark_on_application'],
  ['trigger-rules', 'ruleKey', 'clear_mark_on_natural_end'],
  ['processes', 'processKey', 'apply_mark_state'],
  ['processes', 'processKey', 'clear_mark'],
  ['internal-states', 'stateKey', 'essence_flux_mark_active'],
];
// 所有目标先与备份逐对象对照，避免开始删除后才发现其他目标已被修改。
for (const [resource, field, key] of targets) {
  const actual = await call('GET', `/${resource}/${key}`);
  assert.deepEqual(actual, snapshot[resource].find(item => item[field] === key), `待删除对象已变化：${resource}/${key}`);
}
for (const [resource, , key] of targets) {
  await call('DELETE', `/${resource}/${key}`, 204);
  await call('GET', `/${resource}/${key}`, 404);
}
await fs.writeFile(new URL('lifecycle-projection-cleanup.json', output), JSON.stringify({ checkedAt: new Date().toISOString(), removed: targets.map(([resource, , key]) => `${resource}/${key}`), events }, null, 2));
console.log(JSON.stringify({ removedRules: 2, removedProcesses: 2, removedStates: 1, requests: events.length }));

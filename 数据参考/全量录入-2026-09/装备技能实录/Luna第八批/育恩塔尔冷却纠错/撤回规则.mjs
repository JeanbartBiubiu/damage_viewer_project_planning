import fs from 'node:fs';
import assert from 'node:assert/strict';
const apply = process.argv.includes('--apply');
assert.ok(process.argv.slice(2).every(x => x === '--apply'));
const old = JSON.parse(fs.readFileSync(new URL('./撤回前完整规则.json', import.meta.url)));
const endpoint = '/skills/item_3032_passive/trigger-rules/resolve_attack_speed_on_champion_attack';
assert.equal(old.endpoint, endpoint);
async function request(method = 'GET') {
  const r = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + endpoint, { method, headers: { Authorization: 'Bearer local-entry' }, signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : null };
}
const report = { at: new Date().toISOString(), mode: apply ? '精确撤回' : '只读核对', endpoint, passed: false };
try {
  report.before = await request();
  if (report.before.status === 404) report.action = '已撤回，同值跳过';
  else {
    assert.equal(report.before.status, 200);
    assert.deepEqual(report.before.data, old.data, '旧规则已变化，停止而不删除');
    if (apply) {
      report.write = await request('DELETE');
      assert.ok([200,204].includes(report.write.status));
    }
  }
  report.after = await request();
  report.passed = report.after.status === 404;
  if (apply) assert.ok(report.passed, '撤回后不是404');
} catch (error) { report.failure = String(error); process.exitCode = 1; }
const stamp = report.at.replaceAll(':', '-');
fs.writeFileSync(new URL('./' + (apply ? '撤回记录-' : '只读核对-') + stamp + '.json', import.meta.url), JSON.stringify(report,null,2) + '\n', { flag:'wx' });
console.log(JSON.stringify({ mode:report.mode,writeStatus:report.write?.status,afterStatus:report.after?.status,passed:report.passed,failure:report.failure }));

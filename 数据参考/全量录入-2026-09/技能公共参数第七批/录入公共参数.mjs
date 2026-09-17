import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

// 默认只读。显式 --apply 只补缺项，整批预检通过后才写入，不覆盖或删除既有值。
const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(here, '../技能公共参数实录');
const apply = process.argv.includes('--apply');
assert.ok(process.argv.slice(2).every(x => x === '--apply'), '仅支持 --apply');
const candidateBytes = fs.readFileSync(path.join(here, '公共参数候选.json'));
const batch = JSON.parse(candidateBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const headers = { Authorization: 'Bearer local-entry', 'Content-Type': 'application/json' };
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const report = { observedAt: new Date().toISOString(), mode: apply ? '补缺实录' : '只读核对',
  candidateSha256: sha(candidateBytes), gameId: 'lol', selectedHeroes: batch.selectedHeroes,
  preflightPassed: false, records: [], missing: [], conflicts: [],
  totals: batch.totals, mechanismStatus: '仅基础公共参数，完整机制未完成', runtimeValidation: '未执行' };
const reportFile = path.join(here, apply ? '实录回读.json' : '独立核对.json');
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
async function request(endpoint, body) {
  const response = await fetch(base + endpoint, { method: body ? 'POST' : 'GET', headers,
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok && response.status !== 404) throw new Error(`${endpoint}: HTTP ${response.status}`);
  return { status: response.status, data };
}
const project = (actual, expected) => expected && typeof expected === 'object'
  ? Array.isArray(expected) ? actual?.map((v, i) => project(v, expected[i]))
    : Object.fromEntries(Object.keys(expected).map(k => [k, project(actual?.[k], expected[k])]))
  : actual;
const tasks = [];
try {
  const verifiedSources = new Set();
  for (const skill of batch.entries.filter(x => x.parameters.length)) {
    for (const [kind, source] of Object.entries(skill.sources)) {
      if (verifiedSources.has(source.path)) continue;
      const bytes = fs.readFileSync(path.join(sourceDir, source.path));
      assert.equal(sha(kind === 'client' ? gunzipSync(bytes) : bytes), source.sha256, source.path);
      verifiedSources.add(source.path);
    }
    const endpoint = `/skills/${skill.skillKey}`;
    const owner = await request(endpoint);
    assert.equal(owner.status, 200, skill.skillKey);
    assert.equal(owner.data.maxLevel, skill.maxLevel, skill.skillKey + ' 等级范围');
    const list = await request(endpoint + '/parameters');
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.data));
    assert.equal(new Set(skill.parameters.map(p => p.parameterKey)).size, skill.parameters.length);
    for (const expected of skill.parameters) {
      const current = list.data.find(p => p.parameterKey === expected.parameterKey);
      if (current) {
        const detail = await request(`${endpoint}/parameters/${expected.parameterKey}`);
        try { assert.equal(detail.status, 200); assert.deepEqual(project(detail.data, expected), expected); }
        catch { report.conflicts.push({ skillKey: skill.skillKey, parameterKey: expected.parameterKey, reason: '已有同键值不同，保留原值' }); }
      } else {
        // 防止在已有手工冷却/法力参数旁边再建一个等价键；交给主负责人核对后再处理。
        const suspect = list.data.filter(p => expected.parameterKey === 'cooldown_ms'
          ? /cooldown|冷却/i.test(`${p.parameterKey} ${p.name}`)
          : expected.parameterKey === 'mana_cost'
            ? /mana.*cost|cost.*mana|法力.*消耗|消耗.*法力/i.test(`${p.parameterKey} ${p.name}`)
            : /cast_interval|施放间隔/i.test(`${p.parameterKey} ${p.name}`));
        if (suspect.length) report.conflicts.push({ skillKey: skill.skillKey, parameterKey: expected.parameterKey,
          reason: '发现其他键的同类参数，未创建重复项', existingKeys: suspect.map(p => p.parameterKey) });
      }
      tasks.push({ skillKey: skill.skillKey, expected });
    }
  }
  assert.equal(tasks.length, batch.totals.parameters);
  save();
  assert.equal(report.conflicts.length, 0, '整批预检存在冲突，未开始写入');
  report.preflightPassed = true;
  save();
  for (const task of tasks) {
    const endpoint = `/skills/${task.skillKey}/parameters/${task.expected.parameterKey}`;
    let found = await request(endpoint);
    let action = '保留已有一致值';
    if (found.status === 404) {
      if (!apply) { report.missing.push(endpoint); save(); continue; }
      const created = await request(`/skills/${task.skillKey}/parameters`, task.expected);
      assert.ok(created.status >= 200 && created.status < 300);
      action = '新增';
    } else assert.deepEqual(project(found.data, task.expected), task.expected, endpoint);
    found = await request(endpoint);
    assert.equal(found.status, 200);
    assert.deepEqual(project(found.data, task.expected), task.expected, endpoint + ' 独立回读');
    report.records.push({ skillKey: task.skillKey, endpoint, action, expected: task.expected,
      actual: found.data, matches: true, checkedAt: new Date().toISOString() });
    save();
  }
  report.counts = { verifiedParameters: report.records.length,
    verifiedSkills: new Set(report.records.map(x => x.skillKey)).size,
    created: report.records.filter(x => x.action === '新增').length,
    missing: report.missing.length, conflicts: report.conflicts.length };
  report.passed = report.missing.length === 0 && report.records.length === tasks.length;
  save();
  console.log(JSON.stringify({ mode: report.mode, preflightPassed: true, passed: report.passed, ...report.counts }));
} catch (error) {
  report.passed = false;
  report.failure = { name: error.name, message: error.message };
  save();
  throw error;
}

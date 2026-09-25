import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), step = Number(process.argv[2]);
assert(Number.isInteger(step) && step >= 1 && step <= 6, '每笔成功且已关闭重开后传1至6；不得推测保存完成');
const baseline = JSON.parse(fs.readFileSync(path.join(here, '09-返回前独立现值.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(path.join(here, '10-页面候选待前端审查.json'), 'utf8'));
const writes = plan.candidates.flatMap(c => c.writes), completed = writes.slice(0, step);
const previous = step === 1 ? baseline : JSON.parse(fs.readFileSync(path.join(here, `11-页面独立回读-${step - 1}.json`), 'utf8'));
const stripMetadata = v => { const out = structuredClone(v); for (const key of ['gameId', 'skillKey', 'createdAt', 'updatedAt']) delete out[key]; return out; };
const token = crypto.randomUUID(), values = {}, audit = [];
for (const route of Object.keys(baseline.values)) {
  const created = completed.find(w => w.detailRoute === route);
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route,
    { method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const expected = baseline.values[route]?.http === 404 && !created ? 404 : 200;
  audit.push({ method: 'GET', route, status: response.status }); assert.equal(response.status, expected, route);
  const value = values[route] = response.status === 404 ? { http: 404 } : await response.json();
  if (created) {
    if (route.startsWith('/modifier-zones/') || route.includes('/effects/')) assert.equal(value.gameId, 'lol', `${route} 游戏归属`);
    if (route.includes('/effects/')) assert.equal(value.skillKey, route.split('/')[2], `${route} 技能归属`);
    assert.deepEqual(stripMetadata(value), created.body, route);
    if (previous.values[route]?.http !== 404) assert.deepEqual(value, previous.values[route], `${route} 已保存对象被改动`);
  } else if (route === '/modifier-zones') {
    const added = completed.filter(w => w.route === route);
    assert.equal(value.total, baseline.values[route].total + added.length);
    assert.equal(value.items.length, value.total);
    assert.equal(new Set(value.items.map(x => x.modifierZoneKey)).size, value.total);
    for (const old of baseline.values[route].items) assert.deepEqual(value.items.find(x => x.modifierZoneKey === old.modifierZoneKey), old);
    for (const next of added) {
      const saved = value.items.find(x => x.modifierZoneKey === next.body.modifierZoneKey);
      assert.equal(saved.gameId, 'lol', '新乘区游戏归属');
      assert.deepEqual(stripMetadata(saved), next.body);
    }
  } else if (plan.candidates.some(c => route === `/skills/${c.skillKey}/effects` || route === `/skills/${c.skillKey}/trigger-rules`)) {
    const added = completed.filter(w => w.route === route);
    assert.equal(value.length, added.length + baseline.values[route].length, route);
    const key = route.endsWith('/effects') ? 'effectKey' : 'ruleKey';
    assert.deepEqual(value.map(x => x[key]).sort(), [...baseline.values[route].map(x => x[key]), ...added.map(x => x.body[key])].sort(), route);
    for (const old of baseline.values[route]) assert.deepEqual(value.find(x => x[key] === old[key]), old);
  } else assert.deepEqual(value, baseline.values[route], route);
}
const references = [];
for (const candidate of plan.candidates) {
  const effectRoute = `/skills/${candidate.skillKey}/effects/basic_attack_health_bonus`;
  if (values[effectRoute].http === 404) continue;
  const result = values[effectRoute].results[0];
  const c = result.detail.condition;
  assert(values[`/attributes/${c.attributeKey}`]);
  assert(values[`/skills/${candidate.skillKey}/parameters/${c.comparisonValue.parameterKey}`]);
  assert(values[`/skills/${candidate.skillKey}/parameters/${result.valueRule.value.parameterKey}`]);
  assert(values[`/modifier-zones/${result.detail.modifierZoneKey}`]?.http !== 404);
  references.push({ skill: candidate.skillKey, attribute: c.attributeKey, thresholdParameter: c.comparisonValue.parameterKey,
    amountParameter: result.valueRule.value.parameterKey, zone: result.detail.modifierZoneKey });
  const ruleRoute = `/skills/${candidate.skillKey}/trigger-rules/initialize_basic_attack_bonus`;
  if (values[ruleRoute].http !== 404) assert.equal(values[ruleRoute].actions[0].detail.effectKey, values[effectRoute].effectKey);
}
fs.writeFileSync(path.join(here, `11-页面独立回读-${step}.json`), JSON.stringify({ at: new Date().toISOString(), status: 'PASS', step,
  approvedBodySource: '10-页面候选待前端审查.json', audit, values, references,
  originalResponsesProtected: 32, completedPageWrites: step, businessWritesByReader: 0,
  runtimeValidated: false, wholeRuneComplete: false }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: 'PASS', step, GETs: audit.length, references, businessWritesByReader: 0 }));

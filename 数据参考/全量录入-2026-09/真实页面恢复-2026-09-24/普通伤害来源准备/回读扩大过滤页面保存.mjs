import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), step = Number(process.argv[2]);
assert(Number.isInteger(step) && step >= 1 && step <= 4, '每笔已获批准、页面保存且重开后传1至4；不推测写入完成');
const read = file => JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'));
const baseline = read('08-扩大过滤前独立现值.json'), plan = read('09-扩大过滤页面候选.json');
const previous = step === 1 ? baseline : read(`11-扩大过滤独立回读-${step - 1}.json`);
const completed = plan.writes.slice(0, step), current = completed.at(-1);
const withoutUpdateTime = value => { const copy = structuredClone(value); delete copy.updatedAt; return copy; };
const audit = [], values = {}, token = crypto.randomUUID();
for (const route of Object.keys(baseline.values)) {
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, {
    method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  assert.equal(response.status, 200, route); values[route] = await response.json();
  audit.push({ method: 'GET', route, status: response.status });
}
for (const [route, value] of Object.entries(values)) {
  const write = completed.find(item => item.detailRoute === route);
  const listWrites = completed.filter(item => item.detailRoute.slice(0, item.detailRoute.lastIndexOf('/')) === route);
  if (write) {
    assert.deepEqual(withoutUpdateTime(value), withoutUpdateTime({ ...baseline.values[route], ...write.body }), route);
    if (Object.hasOwn(write.before, 'updatedAt')) assert(Number.isFinite(Date.parse(value.updatedAt)), `${route} 更新时间需合法`);
    else assert.equal(Object.hasOwn(value, 'updatedAt'), false, `${route} 详情形状应与原接口一致`);
    if (route !== current.detailRoute) assert.deepEqual(value, previous.values[route], `${route} 已保存对象被再次改动`);
  } else if (listWrites.length) {
    assert(Array.isArray(value)); assert.equal(value.length, baseline.values[route].length);
    const key = route.endsWith('/effects') ? 'effectKey' : 'ruleKey';
    for (const old of baseline.values[route]) {
      const matching = listWrites.find(item => item.before[key] === old[key]);
      const row = value.find(item => item[key] === old[key]); assert(row, `${route} 列表条目丢失`);
      if (!matching) assert.deepEqual(row, old, `${route}/${old[key]}`);
      else {
        const expected = { ...old, name: matching.body.name, description: matching.body.description };
        assert.deepEqual(withoutUpdateTime(row), withoutUpdateTime(expected), `${route}/${old[key]}`);
        if (matching.detailRoute !== current.detailRoute) {
          assert.deepEqual(row, previous.values[route].find(item => item[key] === old[key]), '前笔列表行及时间应保持');
        } else {
          assert(Number.isFinite(Date.parse(row.updatedAt)), '列表更新时间需合法');
          assert(Date.parse(row.updatedAt) >= Date.parse(old.updatedAt), '列表更新时间不能倒退');
          // 效果详情有更新时间；触发规则详情按既有契约不返回时间戳。
          if (Object.hasOwn(values[matching.detailRoute], 'updatedAt')) {
            assert.equal(row.updatedAt, values[matching.detailRoute].updatedAt, '列表与详情时间应对应同一保存');
          }
        }
      }
    }
  } else assert.deepEqual(value, baseline.values[route], `${route} 受保护现值`);
}
for (const skillKey of ['rune_8014_passive', 'rune_8017_passive']) {
  const effect = values[`/skills/${skillKey}/effects/basic_attack_health_bonus`];
  const rule = values[`/skills/${skillKey}/trigger-rules/initialize_basic_attack_bonus`];
  assert.equal(effect.results.length, 1); assert.equal(rule.actions.length, 1);
  assert.equal(rule.actions[0].detail.effectKey, effect.effectKey);
  const result = effect.results[0];
  assert.equal(result.valueRule.value.parameterKey, 'bonus_damage_ratio');
  assert.equal(result.detail.condition.comparisonValue.parameterKey, 'target_health_threshold_ratio');
  assert.equal(result.detail.condition.attributeKey, 'hp');
  assert(values[`/modifier-zones/${result.detail.modifierZoneKey}`]);
}
assert.equal(audit.length, 38); assert.equal(values['/modifier-zones'].total, 11);
fs.writeFileSync(path.join(here, `11-扩大过滤独立回读-${step}.json`), JSON.stringify({
  at: new Date().toISOString(), step, method: current.method, updatedRoute: current.route,
  businessWritesByThisScript: 0, independentGETs: audit.length, exactApprovedBody: true,
  unrelatedResponsesPreserved: true, referencesChecked: true, modifierZonesPreserved: 11,
  wholeRunesComplete: false, audit, values
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ step, independentGETs: audit.length, exactApprovedBody: true, protected: true }));

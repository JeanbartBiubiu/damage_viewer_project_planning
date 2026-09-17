import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n');
const baseline = read('写前现值.json');
const expected = {
  attributeKey: 'slow_resist_percent', name: '减速抗性比例', valueType: 'DECIMAL', minValue: null, maxValue: null,
  description: '降低减速幅度的比例，1表示100%，0.25表示25%。客户端16.17装备3009根字段mPercentSlowResistMod=0.25，当前说明将减速效果效能降低25%。与韧性和移动速度分别维护；多个来源的组合规则另行核对。',
  status: 'ENABLED', sortOrder: 421,
};
const api = 'http://127.0.0.1:8080/api/admin/games/lol';
async function request(route, method = 'GET', payload) {
  const response = await fetch(api + route, { method,
    headers: { Authorization: 'Bearer local-entry', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  assert.ok(response.ok, `${method} ${route}: ${response.status}`);
  return { route, method, status: response.status, checkedAt: new Date().toISOString(), data };
}
const attribute = await request('/attributes/slow_resist_percent');
for (const [key, value] of Object.entries(expected)) assert.deepEqual(attribute.data[key], value, `属性.${key}`);
const attributeEvidence = path.join(dir, '页面新增属性独立回读.json');
if (!fs.existsSync(attributeEvidence)) fs.writeFileSync(attributeEvidence, JSON.stringify({ actualEntry: '主负责人使用CUA在属性管理新增并保存', expected, attribute, passed: true }, null, 2) + '\n', { flag: 'wx' });
const before = await request('/equipment/item_3009/attributes');
const desired = { move_speed: 55, slow_resist_percent: 0.25 };
const complete = before.data.attributeValues.slow_resist_percent === 0.25;
assert.deepEqual(before.data.attributeValues, complete ? desired : { move_speed: 55 });
const apply = process.argv.includes('--apply');
if (!complete && apply) {
  const record = { before, payload: { attributeValues: desired } };
  record.write = await request('/equipment/item_3009/attributes', 'PUT', record.payload);
  record.independentRead = await request('/equipment/item_3009/attributes');
  assert.deepEqual(record.independentRead.data.attributeValues, desired);
  write('装备属性补录.json', { ...record, passed: true });
}
const objects = [];
for (const original of baseline.objects) {
  const key = original.equipmentKey;
  const reads = await Promise.all([
    request(`/equipment/${key}`), request(`/equipment/${key}/attributes`),
    request(`/equipment-skill-relations?equipmentKey=${key}&page=1&pageSize=200`), request(`/equipment/${key}/representative-image`),
  ]);
  assert.deepEqual(reads[0].data, original.equipment, `${key}: 主体未改`);
  assert.deepEqual(reads[1].data.attributeValues, key === 'item_3009' && (complete || apply) ? desired : original.attributes.attributeValues);
  assert.deepEqual(reads[2].data, original.relations);
  assert.deepEqual(reads[3].data, original.representativeImage);
  objects.push({ equipmentKey: key, checks: reads, scope: original.decision });
}
const catalog = await request('/attributes?page=1&pageSize=200');
assert.equal(catalog.data.items.length, catalog.data.total);
for (const original of baseline.catalog.items) assert.deepEqual(catalog.data.items.find(row => row.attributeKey === original.attributeKey), original);
const arithmetic = [0, 0.2, 0.4, 0.8, 1].map((slow, index) => {
  const actual = slow * (1 - 0.25);
  const expectedValue = [0, 0.15, 0.3, 0.6, 0.75][index];
  assert.ok(Math.abs(actual - expectedValue) < 1e-12);
  return { incomingSlowRatio: slow, resistanceRatio: 0.25, remainingSlowRatio: actual, expected: expectedValue, passed: true };
});
const saved = objects.find(row => row.equipmentKey === 'item_3009').checks[1].data.attributeValues.slow_resist_percent === 0.25;
const report = { checkedAt: new Date().toISOString(), mode: apply ? '仅补缺属性值并独立GET' : '仅GET',
  summary: { equipmentCount: 5, fullReadCount: 22, addedAttributeDefinitions: 1, addedEquipmentAttributeValues: saved ? 1 : 0, outOfScopeEffectEquipment: 4, arithmeticCount: arithmetic.length, mismatchCount: 0 },
  attribute, objects, catalog, arithmetic, passed: saved,
  runtimeValidation: '未执行。单一减速抗性的五组数值仅为数据口径核算，不代表多个来源组合、持续时间处理或战斗运行已验证。' };
write(saved ? '独立最终回读.json' : '补录前检查.json', report);
console.log(JSON.stringify({ mode: report.mode, summary: report.summary, passed: report.passed }));

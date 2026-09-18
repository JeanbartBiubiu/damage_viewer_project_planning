import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const historical = JSON.parse(fs.readFileSync(path.join(root, 'API实录/英雄全量核对/汇总.json'), 'utf8'));
const ez = JSON.parse(fs.readFileSync(path.join(root, 'API实录/英雄全量核对/ez.json'), 'utf8'));
const token = crypto.randomUUID(), requests = [];
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
async function get(p) {
  const r = await fetch(base + p, {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(30000)});
  requests.push({method: 'GET', path: p, status: r.status}); assert.equal(r.status, 200, p); return r.json();
}
const startedAt = new Date().toISOString(), list = await get('/characters');
const rows = Array.isArray(list) ? list : list.items;
assert.deepEqual(rows.map(x => x.characterKey).sort(), historical.items.map(x => x.characterKey).sort());
const items = [];
for (const source of historical.items) {
  const current = await get(`/characters/${source.characterKey}/attributes`);
  assert.equal(current.minLevel, 1); assert.equal(current.maxLevel, 18);
  assert.equal(Object.keys(current.levelValues).length, 18);
  const keys = [...new Set(Object.values(current.levelValues).flatMap(Object.keys))].sort();
  for (const attrs of Object.values(current.levelValues)) assert.deepEqual(Object.keys(attrs).sort(), keys);
  const valueCount = Object.values(current.levelValues).reduce((n, a) => n + Object.keys(a).length, 0);
  if (source.characterKey === 'ez') for (const extra of ez.extraConfigured) for (const [level, expected] of Object.entries(extra.levels)) {
    assert.equal(current.levelValues[level][extra.attributeKey], expected, `保留属性漂移 ${level}/${extra.attributeKey}`);
  }
  items.push({characterKey: source.characterKey, attributeKeys: keys, attributes: keys.length, levelValues: valueCount,
    historicalSourceAttributes: source.sourceExplicitAttributes, historicalPreservedExtras: source.extraConfigured,
    attributeCountDeltaSinceHistoricalReadback: keys.length - source.sourceExplicitAttributes - source.extraConfigured,
    responseSha256: crypto.createHash('sha256').update(JSON.stringify(current)).digest('hex')});
}
const counts = {characters: items.length, attributes: items.reduce((n, x) => n + x.attributes, 0), levelValues: items.reduce((n, x) => n + x.levelValues, 0)};
const report = {startedAt, finishedAt: new Date().toISOString(), status: 'PASS', base, businessWrites: 0,
  historicalSource: {at: historical.finishedAt, characters: historical.coverage.checked, attributes: historical.totals.sourceExplicitAttributes, levelValues: historical.totals.sourceExplicitValues},
  preservedExtras: {characterKey: 'ez', attributes: ez.extraConfigured.length, levelValues: ez.extraConfigured.reduce((n, x) => n + Object.keys(x.levels).length, 0), keys: ez.extraConfigured.map(x => x.attributeKey), exactValuesMatched: true},
  current: counts, changes: items.filter(x => x.attributeCountDeltaSinceHistoricalReadback !== 0), items, requests,
  boundary: '当前角色范围、全部属性键数与等级覆盖已核对，伊泽瑞尔六个历史保留属性逐值一致；本次未重新核算全部英雄属性数值，不代表技能机制或战斗运行完成。'};
fs.writeFileSync(path.join(here, '01-只读核对.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({status: report.status, GETs: requests.length, ...counts, changedCharacterCount: report.changes.length, preservedExtras: report.preservedExtras}));

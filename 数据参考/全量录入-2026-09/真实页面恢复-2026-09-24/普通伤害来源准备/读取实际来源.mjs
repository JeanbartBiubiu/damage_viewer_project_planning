import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const token = crypto.randomUUID(), values = {}, audit = [], summary = [];
async function get(route) {
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route,
    { method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  audit.push({ method: 'GET', route, status: response.status }); assert.equal(response.status, 200, route);
  const body = await response.json(); values[route] = body; return body;
}
for (const skillKey of ['shared_basic_attack', 'annie_q', 'garen_r']) {
  const skill = await get(`/skills/${skillKey}`); assert.equal(skill.gameId, 'lol'); assert.equal(skill.skillKey, skillKey);
  const relations = await get(`/character-skill-relations?skillKey=${skillKey}`);
  assert(relations.items.every(x => x.gameId === 'lol' && x.skillKey === skillKey));
  const objects = {};
  for (const [collection, keyName] of [['parameters', 'parameterKey'], ['formulas', 'formulaKey'], ['effects', 'effectKey'], ['trigger-rules', 'ruleKey']]) {
    const rows = await get(`/skills/${skillKey}/${collection}`); assert(Array.isArray(rows));
    objects[collection] = [];
    for (const row of rows) {
      assert(typeof row[keyName] === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(row[keyName]));
      objects[collection].push(await get(`/skills/${skillKey}/${collection}/${row[keyName]}`));
    }
  }
  const damageResults = objects.effects.flatMap(e => e.results.filter(r => r.resultType === 'DAMAGE').map(r => ({
    effectKey: e.effectKey, resultKey: r.resultKey, target: r.target, valueRule: r.valueRule,
    damageType: r.detail.damageTypeKey, delivery: r.detail.deliveryKind, origin: r.detail.originKind,
    vampQualification: r.detail.vampQualification, spellShieldBlockScope: r.spellShieldBlockScope,
    lifecycle: e.lifecycle, lifecycleBehavior: r.lifecycleBehavior
  })));
  summary.push({ skillKey, name: skill.name, characterOwners: relations.items.map(x => x.characterKey),
    counts: Object.fromEntries(Object.entries(objects).map(([k, v]) => [k, v.length])), damageResults,
    sourceClassification: '待根据来源与实际构造核定，不因字段形状或挂载关系自动批准普通伤害' });
}
fs.writeFileSync(path.join(here, '01-普通物理魔法真实伤害实际来源.json'), JSON.stringify({ at: new Date().toISOString(),
  purpose: '扩大两符文伤害范围前，核对现行已保存普通伤害生产来源及挂载，准备来源批准边界',
  status: 'READ_ONLY_PREPARATION', businessWrites: 0, audit, values, summary }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: 'READ_ONLY_PREPARATION', GETs: audit.length, businessWrites: 0, summary }, null, 2));

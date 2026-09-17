import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = path.dirname(fileURLToPath(import.meta.url));
const base = 'http://127.0.0.1:8080/api/admin/games/lol/skills';
async function get(suffix) {
  const res = await fetch(base + suffix, { headers: { Authorization: 'Bearer local-entry' }, signal: AbortSignal.timeout(30000) });
  assert.equal(res.status, 200);
  return res.json();
}
function evaluate(node, parameters, rank, attributes) {
  if (node.nodeType === 'PARAMETER') {
    const p = parameters.find(p => p.parameterKey === node.parameterKey);
    assert.ok(p);
    return p.valueMode === 'FIXED' ? p.fixedValue : p.levelValues[rank];
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const val = attributes[`${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`];
    assert.equal(typeof val, 'number');
    return val;
  }
  const [a, b] = node.operands.map(x => evaluate(x, parameters, rank, attributes));
  if (node.operation === 'ADD') return a + b;
  if (node.operation === 'MULTIPLY') return a * b;
  throw new Error(`本次算术验收未使用该运算：${node.operation}`);
}
const cases = [
  ['ashe_w', 1, 60, 100, 0, 120],
  ['ashe_w', 1, 60, 300, 0, 120],
  ['ashe_w', 5, 90, 100, 0, 290],
  ['ashe_r', 1, 0, 100, 100, 320],
  ['ashe_r', 3, 0, 100, 500, 1200]
];
const records = [];
for (const key of ['ashe_w', 'ashe_r']) {
  const parameters = await get(`/${key}/parameters`);
  const formula = await get(`/${key}/formulas/hit_damage`);
  const effect = await get(`/${key}/effects/hit_damage`);
  assert.equal(effect.results[0].valueRule.value.formulaKey, formula.formulaKey);
  for (const [skillKey, rank, bonusAD, baseAD, ap, expected] of cases.filter(x => x[0] === key)) {
    const actual = evaluate(formula.expression, parameters, rank, {
      'SOURCE.attack_damage.BONUS': bonusAD,
      'SOURCE.attack_damage.BASE': baseAD,
      'SOURCE.attack_damage.TOTAL': bonusAD + baseAD,
      'SOURCE.ability_power.TOTAL': ap
    });
    assert.equal(actual, expected);
    records.push({ skillKey, rank, bonusAD, baseAD, ap, expected, actual });
  }
}
fs.writeFileSync(path.join(dir, '算术核对.json'), JSON.stringify({ observedAt: new Date().toISOString(), evidence: '实时 GET 配置后的独立算术样例，不是战斗运行', records, passed: records.length }, null, 2) + '\n');
console.log(`算术核对通过 ${records.length} 项；W 改变基础攻击力而额外攻击力不变时，伤害不变。`);

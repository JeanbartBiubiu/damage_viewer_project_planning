import fs from 'node:fs';
import assert from 'node:assert/strict';
const candidate = JSON.parse(fs.readFileSync(new URL('./录入候选.json', import.meta.url)));
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const output = { checkedAt: new Date().toISOString(), method: '主负责人独立GET字段复核', records: [], passed: false,
  status: '已保存组成；完整咒刃、重伤、女妖等接线继续补录', runtimeValidation: '未执行' };
async function get(endpoint) {
  const r = await fetch(base + endpoint, { headers: { Authorization: 'Bearer local-entry' }, signal: AbortSignal.timeout(30000) });
  assert.equal(r.status, 200, endpoint); return r.json();
}
function project(actual, expected) {
  if (Array.isArray(expected)) return actual?.map((v, i) => project(v, expected[i]));
  if (expected && typeof expected === 'object') return Object.fromEntries(Object.keys(expected).map(k => [k, project(actual?.[k], expected[k])]));
  return actual;
}
let components = 0;
for (const object of candidate.objects) {
  const record = { equipmentKey: object.equipmentKey, skillKey: object.skill.skillKey, components: [] };
  const path = '/skills/' + object.skill.skillKey;
  const check = async (endpoint, expected, kind) => {
    const actual = await get(endpoint);
    assert.deepEqual(project(actual, expected), expected, endpoint);
    record.components.push({ endpoint, kind, expected, actual, matches: true }); components++;
  };
  await check(path, object.skill, 'skill');
  for (const [kind, type, key] of [['parameters', 'parameters', 'parameterKey'], ['formulas', 'formulas', 'formulaKey'], ['effects', 'effects', 'effectKey'], ['triggerRules', 'trigger-rules', 'ruleKey']]) {
    for (const component of object[kind]) await check(`${path}/${type}/${component[key]}`, component, type);
  }
  const relations = await get('/equipment-skill-relations?equipmentKey=' + object.equipmentKey);
  const relation = (Array.isArray(relations) ? relations : relations.items).find(r => r.skillKey === object.skill.skillKey);
  assert.deepEqual(project(relation, object.relation), object.relation);
  const equipmentImage = await get(`/equipment/${object.equipmentKey}/representative-image`);
  const skillImage = await get(`${path}/representative-image`);
  assert.ok(equipmentImage.image.enabled && skillImage.image.enabled);
  assert.equal(skillImage.image.imageKey, equipmentImage.image.imageKey);
  record.relation = relation; record.imageKey = skillImage.image.imageKey; record.imageEnabled = true;
  components += 2;
  output.records.push(record);
}
output.counts = { skills: 6, parameters: 19, formulas: 4, effects: 8, triggerRules: 3, equipmentRelations: 6, representativeImageReuses: 6 };
assert.equal(output.records.length, output.counts.skills);
assert.equal(components, 52);
output.components = components;
output.passed = true;
fs.writeFileSync(new URL('./主负责人复核.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ components, ...output.counts, passed: true }));

import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const [base, snapshotPath, outputPath] = process.argv.slice(2);
if (!base || !snapshotPath || !outputPath) throw new Error('参数：管理 API 根地址 迁移前快照 输出路径');
const api = new URL(base);
if (api.hostname !== '127.0.0.1') throw new Error('仅用于本机验收服务');
let reads = 0;
async function get(path) {
  const response = await fetch(base + path, { headers: { Authorization: 'Bearer local-aggregate-acceptance-placeholder' } });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  reads++;
  return response.json();
}
const before = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
const after = structuredClone(before);
for (const [skillKey, parts] of Object.entries(before.skills)) {
  for (const [resource, key] of [['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey'],['internal-states','stateKey'],['processes','processKey'],['trigger-rules','ruleKey']]) {
    const summaries = await get(`/skills/${skillKey}/${resource}`);
    const items = Array.isArray(summaries) ? summaries : summaries.items;
    assert.equal(items.length, parts[resource].length, `${skillKey}/${resource} count`);
    after.skills[skillKey][resource] = [];
    for (const expected of parts[resource]) {
      const actual = await get(`/skills/${skillKey}/${resource}/${expected[key]}`);
      assert.deepEqual(actual, expected, `${skillKey}/${resource}/${expected[key]}`);
      after.skills[skillKey][resource].push(actual);
    }
  }
}
assert.deepEqual(await get('/character-skill-relations?characterKey=ez'), before.characterSkillRelations);
assert.deepEqual(await get('/characters/ez/attributes'), before.characterAttributes);
await fs.writeFile(outputPath, JSON.stringify({ checkedAt: new Date().toISOString(), apiReads: reads, allSavedAggregatesEqual: true, characterRelationsAndAttributesEqual: true, after }, null, 2));
console.log(JSON.stringify({ apiReads: reads, allSavedAggregatesEqual: true, characterRelationsAndAttributesEqual: true }));

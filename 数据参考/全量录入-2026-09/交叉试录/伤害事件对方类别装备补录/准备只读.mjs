import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN');

const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const frozen = JSON.parse(fs.readFileSync(path.join(here, '02-冻结请求.json'), 'utf8'));
const staticRequests = [];
let getCount = 0;

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
};
const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaValue = value => shaBytes(JSON.stringify(stable(value)));

async function get(route, record = false) {
  getCount += 1;
  const response = await fetch(base + route, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { parseError: true, responseBytes: Buffer.byteLength(text) }; }
  }
  const result = { method: 'GET', route, status: response.status, data };
  if (record) staticRequests.push(result);
  return result;
}

async function mapLimit(values, limit, work) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await work(values[index], index);
    }
  }));
  return results;
}

assert.equal(frozen.planRevision, 1);
assert.equal(frozen.plannedWrites, 9);
assert.equal(frozen.writes.length, 9);
for (const source of frozen.sources) {
  const bytes = fs.readFileSync(source.path);
  assert.equal(shaBytes(bytes), source.sha256, `来源散列漂移：${source.path}`);
}

const candidateRoutes = frozen.writes.filter(item => item.method === 'POST').map(item => item.detailRoute);
const routes = [
  '/damage-types',
  '/attributes/move_speed',
  '/attributes/mana',
  '/modifier-zones/attribute_flat_add',
  '/equipment/item_4629',
  '/equipment/item_4629/attributes',
  '/equipment-skill-relations?equipmentKey=item_4629',
  '/skills/item_4629_passive',
  '/skills/item_4629_passive/representative-image',
  '/skills/item_4629_passive/parameters',
  '/skills/item_4629_passive/parameters/move_speed_bonus',
  '/skills/item_4629_passive/parameters/move_speed_duration_ms',
  '/skills/item_4629_passive/formulas',
  '/skills/item_4629_passive/effects',
  '/skills/item_4629_passive/effects/spelldance_move_speed',
  '/skills/item_4629_passive/processes',
  '/skills/item_4629_passive/internal-states',
  '/skills/item_4629_passive/trigger-rules',
  '/equipment/item_3803',
  '/equipment/item_3803/attributes',
  '/equipment-skill-relations?equipmentKey=item_3803',
  '/skills/item_3803_passive',
  '/skills/item_3803_passive/representative-image',
  '/skills/item_3803_passive/parameters',
  ...['mana_restore_ratio_from_damage', 'health_restore_ratio_from_mana_cost', 'health_restore_cap_per_cast',
    'eternity_internal_cooldown_ms', 'damage_input', 'mana_cost_input', 'health_restore_cap_per_second']
    .map(key => `/skills/item_3803_passive/parameters/${key}`),
  '/skills/item_3803_passive/formulas',
  ...['mana_restore_from_damage', 'health_restore_uncapped', 'health_restore_from_skill_cost']
    .map(key => `/skills/item_3803_passive/formulas/${key}`),
  '/skills/item_3803_passive/effects',
  '/skills/item_3803_passive/effects/mana_from_hero_damage',
  '/skills/item_3803_passive/effects/health_from_skill_cost',
  '/skills/item_3803_passive/processes',
  '/skills/item_3803_passive/internal-states',
  '/skills/item_3803_passive/trigger-rules',
  ...candidateRoutes
];
for (const route of [...new Set(routes)]) {
  const response = await get(route, true);
  assert.equal(response.status, candidateRoutes.includes(route) ? 404 : 200, route);
}

const skillsResponse = await get('/skills');
assert.equal(skillsResponse.status, 200);
assert(Array.isArray(skillsResponse.data?.items));
assert.equal(skillsResponse.data.items.length, skillsResponse.data.total);
const skillKeys = skillsResponse.data.items.map(item => item.skillKey).sort();
assert.equal(skillKeys.length, 1062, '技能总数与实施前基线不符');

const ruleLists = await mapLimit(skillKeys, 24, async skillKey => {
  const route = `/skills/${encodeURIComponent(skillKey)}/trigger-rules`;
  const response = await get(route);
  assert.equal(response.status, 200, route);
  assert(Array.isArray(response.data), route);
  return { skillKey, rules: response.data };
});
const summaries = ruleLists.flatMap(item => item.rules.map(rule => ({ skillKey: item.skillKey, ruleKey: rule.ruleKey })));
const ruleDetails = await mapLimit(summaries, 24, async item => {
  const route = `/skills/${encodeURIComponent(item.skillKey)}/trigger-rules/${encodeURIComponent(item.ruleKey)}`;
  const response = await get(route);
  assert.equal(response.status, 200, route);
  return { skillKey: item.skillKey, ruleKey: item.ruleKey, data: response.data };
});
ruleDetails.sort((a, b) => a.skillKey.localeCompare(b.skillKey) || a.ruleKey.localeCompare(b.ruleKey));

const damageEvents = new Set(['DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN']);
const categoryCount = ruleDetails.reduce((total, item) => total + item.data.conditionGroups
  .flatMap(group => group.conditions)
  .filter(condition => condition.conditionType === 'TARGET_CATEGORY_CHECK').length, 0);
const damageRules = ruleDetails.filter(item => damageEvents.has(item.data.eventSource.eventType));
const damageRulesWithCategory = damageRules.filter(item => item.data.conditionGroups
  .flatMap(group => group.conditions)
  .some(condition => condition.conditionType === 'TARGET_CATEGORY_CHECK'));
assert.equal(ruleDetails.length, 87, '触发规则总数与实施前基线不符');
assert.equal(categoryCount, 5, '类别条件总数与实施前基线不符');
assert.equal(damageRules.length, 3, '伤害事件规则总数与实施前基线不符');
assert.equal(damageRulesWithCategory.length, 0, '已有伤害事件规则不应包含类别条件');

const cosmicCandidatePath = frozen.sources[0].path;
const catalystCandidatePath = frozen.sources[2].path;
const cosmicCandidate = JSON.parse(fs.readFileSync(cosmicCandidatePath, 'utf8')).objects
  .find(item => item.equipmentKey === 'item_4629');
const catalystCandidate = JSON.parse(fs.readFileSync(catalystCandidatePath, 'utf8')).objects
  .find(item => item.equipmentKey === 'item_3803');
assert(cosmicCandidate);
assert(catalystCandidate);

const sourceSnapshot = {
  capturedAt: new Date().toISOString(),
  methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
  authorizationValueRecorded: false,
  sources: frozen.sources,
  candidates: {
    item_4629: cosmicCandidate,
    item_3803: catalystCandidate
  },
  acceptedFacts: {
    item_4629: { damageTypeKeys: ['magic', 'real'], targetCategory: 'CHAMPION', moveSpeed: 20, durationMs: 4000 },
    item_3803: { eventType: 'DAMAGE_TAKEN', sourceCategory: 'CHAMPION', eventValueKey: 'RAW_DAMAGE', restoreRatio: 0.1 }
  },
  excluded: frozen.excluded
};
const baseline = {
  capturedAt: new Date().toISOString(),
  methodPolicy: 'GET_ONLY',
  authorizationValueRecorded: false,
  getCount,
  businessWrites: 0,
  staticRequests,
  triggerRuleScan: {
    skillCount: skillKeys.length,
    listGetCount: skillKeys.length,
    detailGetCount: ruleDetails.length,
    ruleCount: ruleDetails.length,
    targetCategoryConditionCount: categoryCount,
    damageRuleCount: damageRules.length,
    damageRulesWithTargetCategoryCount: damageRulesWithCategory.length,
    sha256: shaValue(ruleDetails),
    rules: ruleDetails
  }
};
fs.writeFileSync(path.join(here, '03-来源快照.json'), JSON.stringify(sourceSnapshot, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(here, '04-写入前现值.json'), JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx' });

const digest = file => shaBytes(fs.readFileSync(path.join(here, file)));
console.log(JSON.stringify({
  status: 'PASS',
  getCount,
  businessWrites: 0,
  skillCount: skillKeys.length,
  ruleCount: ruleDetails.length,
  categoryConditionCount: categoryCount,
  damageRuleCount: damageRules.length,
  damageRulesWithCategory: damageRulesWithCategory.length,
  hashes: Object.fromEntries(['01-来源与方案.md', '02-冻结请求.json', '03-来源快照.json', '04-写入前现值.json', '05-Cursor独立评审.json']
    .map(file => [file, digest(file)]))
}, null, 2));

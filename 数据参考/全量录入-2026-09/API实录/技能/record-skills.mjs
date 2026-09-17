import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Only the user-authorized local development instance; the token is a public placeholder.
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const dir = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.resolve(dir, '../..');
const plan = JSON.parse(fs.readFileSync(path.join(corpus, '英雄技能全量页面输入/skills-basic-plan.json'), 'utf8'));
const apply = process.argv.includes('--apply');
const relationsOnly = process.argv.includes('--relations-only');
const limitArg = process.argv.find(x => x.startsWith('--limit='));
const selected = limitArg ? plan.skills.slice(0, Number(limitArg.split('=')[1])) : plan.skills;
const records = [];
const previouslyAuthored = new Set(['ez', 'garen', 'ashe', 'lux'].flatMap(key => ['p', 'q', 'w', 'e', 'r'].map(slot => `${key}_${slot}`)));
fs.mkdirSync(path.join(dir, 'records'), { recursive: true });

async function request(route, method = 'GET', body) {
  const res = await fetch(base + route, {
    method,
    headers: { Authorization: 'Bearer local-entry', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json();
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${JSON.stringify(data.error ?? data)}`);
  return data;
}
function record(key, data) {
  const result = { key, at: new Date().toISOString(), method: 'API', ...data };
  fs.writeFileSync(path.join(dir, 'records', `${key}.json`), JSON.stringify(result, null, 2) + '\n');
  fs.appendFileSync(path.join(dir, 'journal.jsonl'), JSON.stringify(result) + '\n');
  records.push(result);
}
function expected(item) {
  const cats = { 被动技能: ['passive'], 普通技能: ['common'] };
  assert.match(item.key, /^[a-z][a-z0-9_]{0,63}$/);
  assert.ok(item.name.length > 0 && item.name.length <= 100);
  assert.ok(item.description.length <= 2000);
  assert.ok(Number.isInteger(item.maxRank) && item.maxRank > 0);
  const category = item.category?.trim() ?? '';
  assert.ok(category === '' || Object.hasOwn(cats, category));
  return { skillKey: item.key, name: item.name.trim(), description: item.description.trim(), maxLevel: item.maxRank,
    status: 'ENABLED', sortOrder: item.sort, skillCategoryKeys: cats[category] ?? [] };
}
function verifyBasic(actual, want, reused) {
  assert.equal(actual.skillKey, want.skillKey);
  assert.equal(actual.maxLevel, want.maxLevel);
  assert.equal(actual.status, 'ENABLED');
  // Existing, already-authored skills retain names, descriptions, sort and any extra classifications.
  if (!reused || !previouslyAuthored.has(want.skillKey)) for (const [key, value] of Object.entries(want)) assert.deepEqual(actual[key], value, key);
}

// Validate the entire batch before the first mutation, including intentionally blank categories.
selected.forEach(expected);
assert.equal(new Set(selected.map(x => x.key)).size, selected.length);
const categories = await request('/skill-categories');
for (const key of ['passive', 'common']) assert.ok(categories.items.some(x => x.skillCategoryKey === key && x.status === 'ENABLED'));
for (const item of selected) {
  if (relationsOnly) break;
  const want = expected(item);
  const before = await request(`/skills/${item.key}`);
  if (!before && !apply) { record(item.key, { status: 'planned', expected: want }); continue; }
  if (!before) await request('/skills', 'POST', want);
  const after = await request(`/skills/${item.key}`);
  verifyBasic(after, want, Boolean(before));
  record(item.key, { status: 'verified', action: before ? 'reused' : 'created', before, expected: want, after,
    remaining: ['数值与机制补证', '技能组成配置', '代表图片核对'] });
  if (records.length % 25 === 0) console.log(JSON.stringify({ phase: 'skills', verified: records.length, total: selected.length }));
}

const grouped = Map.groupBy(selected, x => x.characterKey);
let relationCount = 0;
const missingCharacters = [];
if (apply) for (const [characterKey, skills] of grouped) {
  const character = await request(`/characters/${characterKey}`);
  if (!character) { missingCharacters.push(characterKey); continue; }
  const before = await request(`/character-skill-relations?characterKey=${encodeURIComponent(characterKey)}`);
  const created = [];
  for (const item of skills) {
    const current = before.items.find(x => x.skillKey === item.key);
    if (current) continue;
    if (!(await request(`/skills/${item.key}`))) throw new Error(`Missing skill ${item.key}`);
    await request('/character-skill-relations', 'POST', { characterKey, skillKey: item.key, sortOrder: item.sort });
    created.push(item.key);
  }
  const after = await request(`/character-skill-relations?characterKey=${encodeURIComponent(characterKey)}`);
  for (const item of skills) {
    const matches = after.items.filter(x => x.skillKey === item.key);
    assert.equal(matches.length, 1, item.key);
    const prior = before.items.find(x => x.skillKey === item.key);
    assert.equal(matches[0].sortOrder, prior?.sortOrder ?? item.sort, item.key);
  }
  for (const prior of before.items) assert.ok(after.items.some(x => x.skillKey === prior.skillKey && x.sortOrder === prior.sortOrder));
  relationCount += skills.length;
  record(`relations_${characterKey}`, { status: 'verified', characterKey, created, before, after, count: skills.length });
  if (relationCount % 100 === 0) console.log(JSON.stringify({ phase: 'relations', verified: relationCount }));
}
const summary = { at: new Date().toISOString(), apply, relationsOnly, planned: selected.length,
  created: records.filter(x => x.action === 'created').length, reused: records.filter(x => x.action === 'reused').length,
  verifiedSkills: records.filter(x => x.action).length, verifiedRelations: relationCount, missingCharacters,
  boundary: '基本资料和角色挂载已核对不等于完整技能，未修改既有技能组成或最大等级。' };
fs.writeFileSync(path.join(dir, relationsOnly ? 'relations-summary.json' : 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));

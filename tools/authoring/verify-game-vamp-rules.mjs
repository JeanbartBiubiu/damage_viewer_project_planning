import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

// 仅核定已有来源明确的三个代表结果；不批量推断其他旧伤害的吸血资格。
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const out = path.resolve('output/game-vamp-rules');
const planFile = path.join(out, 'representatives-plan.json');
const attempt = path.join(out, 'representatives-attempt.jsonl');
const token = process.env.DAMAGE_ADMIN_TOKEN || 'test';
const targets = [
  { skillKey: 'shared_basic_attack', effectKey: 'attack_hit', category: 'basic_attack', delivery: 'BASIC_ATTACK' },
  { skillKey: 'annie_q', effectKey: 'spell_hit', category: 'common', delivery: 'SKILL' },
  { skillKey: 'annie_w', effectKey: 'spell_hit', category: 'common', delivery: 'SKILL' }
];
const rules = { rules: [
  { vampType: 'LIFE_STEAL', sourceAttributeKey: 'life_steal_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE',
    defaultEfficiency: 1, deliveryKinds: ['BASIC_ATTACK'], originKinds: ['DIRECT'], skillCategoryKeys: ['basic_attack'] },
  { vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE',
    defaultEfficiency: 1, deliveryKinds: ['SKILL', 'BASIC_ATTACK'], originKinds: ['DIRECT'], skillCategoryKeys: ['basic_attack', 'common', 'passive', 'ultimate'] }
] };
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const effectPath = target => `/skills/${target.skillKey}/effects/${target.effectKey}`;
const bodyOf = value => Object.fromEntries(['name', 'description', 'sortOrder', 'lifecycle', 'results'].map(key => [key, value[key]]));
function record(value) {
  const descriptor = fs.openSync(attempt, 'a');
  try { fs.writeSync(descriptor, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n'); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}
async function request(route, method = 'GET', body) {
  assert.ok(route.startsWith('/'));
  const response = await fetch(base + route, { method, headers: { Authorization: `Bearer ${token}`,
    ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}
async function get(route) {
  const result = await request(route); assert.equal(result.status, 200, `GET ${route}`); return result.data;
}
async function snapshot() {
  const result = { rules: await get('/vamp-rules'), targets: [] };
  for (const target of targets) result.targets.push({ ...target, skill: await get(`/skills/${target.skillKey}`), before: await get(effectPath(target)) });
  return result;
}
async function prepare() {
  assert.ok(!fs.existsSync(attempt), '存在写入尝试，先运行只读核对，不重放');
  const current = await snapshot();
  assert.deepEqual(current.rules, { rules: [] });
  const categories = await get('/skill-categories');
  const categoryKeys = new Set((categories.items ?? categories).map(row => row.skillCategoryKey));
  for (const rule of rules.rules) {
    const attr = await get(`/attributes/${rule.sourceAttributeKey}`);
    assert.equal(attr.gameId, 'lol'); assert.equal(attr.valueType, 'DECIMAL');
    for (const key of rule.skillCategoryKeys) assert.ok(categoryKeys.has(key), `缺分类 ${key}`);
  }
  for (const target of current.targets) {
    assert.equal(target.skill.gameId, 'lol');
    assert.ok(target.skill.skillCategoryKeys.includes(target.category));
    assert.equal(target.before.lifecycle, null);
    const body = structuredClone(bodyOf(target.before));
    const damage = body.results.filter(result => result.resultType === 'DAMAGE');
    assert.equal(damage.length, 1, '代表效果须只有一个已核定的伤害结果');
    assert.equal(damage[0].detail.deliveryKind, target.delivery);
    assert.equal(damage[0].detail.originKind, 'DIRECT');
    assert.equal(damage[0].detail.vampQualification, 'UNRESOLVED');
    assert.deepEqual(damage[0].detail.vampOverrides, []);
    assert.ok(!Object.hasOwn(damage[0].detail, 'vampRules'));
    damage[0].detail.vampQualification = 'RESOLVED';
    if (target.skillKey !== 'shared_basic_attack') body.description = target.before.description.replace(
      /(?:并)?显式登记防御结算后伤害、效率为1的全能吸血资格/g, '吸血资格已核定，继承游戏通用规则，当前无逐结果例外');
    target.body = body;
  }
  const plan = { at: new Date().toISOString(), base, sourceVersion: '16.17/16.17.1',
    rationale: '共享普攻、安妮Q及W的既有直接敌方英雄伤害均已有明确吸血资格；仅改为继承共同规则。其余伤害保持待核定。',
    beforeRules: current.rules, rules, targets: current.targets };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ prepared: true, targets: targets.length, planFile, sha256: hash(fs.readFileSync(planFile)) }));
}
async function apply(expectedHash) {
  const bytes = fs.readFileSync(planFile); assert.equal(hash(bytes), expectedHash, '方案摘要不一致');
  const plan = JSON.parse(bytes); assert.equal(plan.base, base); assert.deepEqual(plan.rules, rules);
  assert.deepEqual(plan.targets.map(row => [row.skillKey, row.effectKey]), targets.map(row => [row.skillKey, row.effectKey]));
  const current = await snapshot(); assert.deepEqual(current.rules, plan.beforeRules);
  for (const target of current.targets) {
    const frozen = plan.targets.find(row => row.skillKey === target.skillKey);
    assert.deepEqual(target.before, frozen.before); assert.deepEqual(target.skill, frozen.skill);
  }
  fs.writeFileSync(attempt, '', { flag: 'wx' });
  const replace = async (route, body, expectedBefore, project = value => value) => {
    assert.deepEqual(await get(route), expectedBefore, `${route}前值漂移`);
    record({ stage: 'WRITE_INTENT', route, bodySha256: hash(canonical(body)), body });
    let result;
    try { result = await request(route, 'PUT', body); }
    catch (error) { record({ stage: 'WRITE_UNKNOWN', route, errorType: error.name }); throw error; }
    record({ stage: 'WRITE_RESPONSE', route, ...result });
    assert.equal(result.status, 200, route);
    const readback = await get(route);
    assert.deepEqual(project(readback), body);
    assert.deepEqual(project(await get(route)), body);
    record({ stage: 'IMMEDIATE_READBACK', route, data: readback });
  };
  await replace('/vamp-rules', plan.rules, plan.beforeRules);
  for (const target of plan.targets) await replace(effectPath(target), target.body, target.before, bodyOf);
  record({ stage: 'COMPLETE', targets: plan.targets.length });
  console.log(JSON.stringify({ applied: true, rules: rules.rules.length, resolvedDamage: targets.length, report: attempt }));
}
async function check(expectedHash) {
  const bytes = fs.readFileSync(planFile);
  assert.equal(hash(bytes), expectedHash, '只读核对必须绑定已冻结方案摘要');
  const plan = JSON.parse(bytes);
  assert.equal(plan.base, base);
  const current = await snapshot();
  const file = path.join(out, `representatives-readback-${Date.now()}.json`);
  fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ planSha256: expectedHash, ...current }, null, 2) + '\n', { flag: 'wx' });
  assert.deepEqual(current.rules, plan.rules);
  for (const target of current.targets) {
    const frozen = plan.targets.find(row => row.skillKey === target.skillKey && row.effectKey === target.effectKey);
    assert.ok(frozen, '代表目标不在冻结计划中');
    assert.deepEqual(target.skill, frozen.skill);
    const expected = { ...frozen.before, ...frozen.body };
    const { updatedAt: actualUpdatedAt, ...actualStable } = target.before;
    const { updatedAt: oldUpdatedAt, ...expectedStable } = expected;
    assert.deepEqual(actualStable, expectedStable, effectPath(target));
    assert.ok(Date.parse(actualUpdatedAt) >= Date.parse(oldUpdatedAt), '更新时间异常');
  }
  console.log(JSON.stringify({ readOnly: true, verified: true, file, rules: current.rules.rules.length,
    damage: current.targets.map(row => ({ skillKey: row.skillKey, results: row.before.results.filter(result => result.resultType === 'DAMAGE').map(result => ({ resultKey: result.resultKey, detail: result.detail })) })) }));
}
try {
  const [mode, expectedHash, extra] = process.argv.slice(2); assert.equal(extra, undefined);
  if (mode === '--prepare' && !expectedHash) await prepare();
  else if (mode === '--apply' && /^[0-9a-f]{64}$/.test(expectedHash)) await apply(expectedHash);
  else if (mode === '--check' && /^[0-9a-f]{64}$/.test(expectedHash)) await check(expectedHash);
  else throw new Error('仅支持 --prepare、--apply <已核对摘要> 或 --check <已核对摘要>');
} catch (error) {
  console.error(`gameVampRepresentative=FAILED ${error.name}: ${error.message}`);
  process.exitCode = 1;
}

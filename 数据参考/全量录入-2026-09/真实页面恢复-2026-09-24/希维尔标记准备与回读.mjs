import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// 只读业务接口；正式新增只由指定执行代理操作真实页面。
const here = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
assert(['prepare', 'readback'].includes(mode));
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(here, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const hashFile = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(here, name))).digest('hex');
const token = crypto.randomUUID(), values = {}, audit = [];
const prefix = '/skills/sivir_r', detailRoute = prefix + '/effects/recent_damage_mark';
async function get(route, mayBeMissing = false) {
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, {
    method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  audit.push({ method: 'GET', route, status: response.status });
  assert(response.status === 200 || mayBeMissing && response.status === 404, route + ': ' + response.status);
  values[route] = response.status === 404 ? { http: 404 } : await response.json();
  return values[route];
}
if (mode === 'prepare') {
  const candidateFile = '../希维尔R参与击杀刷新返回/16-最近伤害标记页面返回候选.json';
  const candidate = read(candidateFile).candidate;
  await get(prefix);
  const collections = { parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey', processes: 'processKey', 'internal-states': 'stateKey', 'trigger-rules': 'ruleKey' };
  for (const [collection, key] of Object.entries(collections)) {
    const list = await get(prefix + '/' + collection);
    assert(Array.isArray(list));
    for (const row of list) await get(prefix + '/' + collection + '/' + row[key]);
  }
  for (const route of [prefix + '/representative-image', '/character-skill-relations?skillKey=sivir_r', '/characters/champion_sivir', '/characters/champion_sivir/representative-image']) await get(route);
  await get(detailRoute, true);
  assert.deepEqual(values[detailRoute], { http: 404 }, '已存在标记，禁止重复新增，应转为返回核验');
  assert.equal(values[prefix + '/parameters/recent_damage_ms'].fixedValue, 3000);
  assert.equal(values[prefix + '/parameters/recent_damage_ms'].valueMode, 'FIXED');
  assert.equal(values[prefix + '/effects'].length, 4);
  assert.equal(candidate.path, prefix + '/effects');
  assert.deepEqual(candidate.body.results, []);
  assert.equal(candidate.body.lifecycle.durationValue.parameterKey, 'recent_damage_ms');
  write('希维尔标记-01-写前现值.json', { at: new Date().toISOString(), audit, values, businessWrites: 0 });
  write('希维尔标记-02-页面批准.json', {
    at: new Date().toISOString(), executionMode: 'PLAYWRIGHT_UI_ONLY', model: 'gpt-6-luna', effort: 'max',
    question: '仅记录来源与目标资格窗口的效果，能否保留真实空结果而正常保存、重开和解释未接线边界',
    baseline: '希维尔标记-01-写前现值.json', baselineSha256: hashFile('希维尔标记-01-写前现值.json'),
    candidateSource: candidateFile, candidateSha256: hashFile(candidateFile),
    requests: [{ method: candidate.method, route: candidate.path, detailRoute, body: candidate.body }],
    protected: '原四效果含刷新辅助效果、全部参数/过程/规则/图片/角色关系完整保持；只新增已有明确用途的资格标记，不接尚未核定的伤害资格和参与击杀规则',
    verification: '结果数零，生命周期开启，3000毫秒参数，同来源同目标实例，重复刷新完整期限；总览应保留未挂接提示；查看原刷新辅助效果证明原对象未变',
    runtimeValidated: false, wholeSkillComplete: false
  });
  console.log(JSON.stringify({ status: 'APPROVED_UI_ONLY', GETs: audit.length, plannedPageWrites: 1, businessWrites: 0 }));
} else {
  const plan = read('希维尔标记-02-页面批准.json'), before = read(plan.baseline), request = plan.requests[0];
  assert.equal(hashFile(plan.baseline), plan.baselineSha256);
  for (const route of Object.keys(before.values)) await get(route);
  const { gameId, skillKey, createdAt, updatedAt, ...body } = values[detailRoute];
  assert.equal(gameId, 'lol'); assert.equal(skillKey, 'sivir_r');
  assert(Number.isFinite(Date.parse(createdAt))); assert(Number.isFinite(Date.parse(updatedAt)));
  assert.deepEqual(body, request.body, '标记保存与批准不一致');
  let protectedResponses = 0;
  for (const [route, original] of Object.entries(before.values)) {
    if (route === detailRoute) continue;
    if (route === prefix + '/effects') {
      assert.equal(values[route].length, original.length + 1);
      assert.deepEqual(values[route].filter(row => row.effectKey !== body.effectKey), original);
      const added = values[route].find(row => row.effectKey === body.effectKey);
      assert.equal(added.resultCount, 0); assert.equal(added.lifecycleEnabled, true);
      assert.equal(added.name, body.name); assert.equal(added.description, body.description);
    } else { assert.deepEqual(values[route], original, '保护内容变化：' + route); protectedResponses++; }
  }
  const check = await get('/characters/champion_sivir/authoring-check');
  const markerReferences = check.references.filter(row => row.sourceSkillKey === 'sivir_r' && row.sourceKey === body.effectKey);
  assert.equal(markerReferences.length, 1, '空结果效果仍须进入生命周期引用检查');
  const reference = markerReferences[0];
  assert.equal(reference.sourceType, 'EFFECT');
  assert.equal(reference.fieldPath, 'lifecycle.durationValue.parameterKey');
  assert.equal(reference.targetType, 'PARAMETER');
  assert.equal(reference.targetSkillKey, 'sivir_r');
  assert.equal(reference.targetKey, 'recent_damage_ms');
  assert.equal(reference.location.objectKey, body.effectKey);
  assert(check.issues.some(row => row.skillKey === 'sivir_r' && row.objectKey === body.effectKey && row.code === 'EFFECT_NOT_CONNECTED'));
  if (!fs.existsSync(path.join(here, '希维尔标记-保存正文独立核对.json'))) {
    write('希维尔标记-保存正文独立核对.json', { at: new Date().toISOString(), status: 'PERSISTENCE_PASS',
      audit, values, protectedResponses, markerReferences, structureAtRead: check.conclusions.structure,
      confirmedPageWrites: 1, businessWrites: 0, runtimeValidated: false, wholeSkillComplete: false });
  }
  assert.equal(check.conclusions.structure, 'NO_ERRORS');
  write('希维尔标记-03-独立回读.json', { at: new Date().toISOString(), status: 'PASS', audit, values,
    protectedResponses, markerReferences, unconnectedReviewPreserved: true,
    confirmedPageWrites: 1, businessWrites: 0, runtimeValidated: false, wholeSkillComplete: false });
  console.log(JSON.stringify({ status: 'PASS', GETs: audit.length, protectedResponses, businessWrites: 0 }));
}

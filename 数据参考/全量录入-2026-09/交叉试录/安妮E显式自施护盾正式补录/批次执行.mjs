import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// 沿用已验收批次的固定散列、纯GET预检、路径限制与落地前防重放；本批只定点读取安妮E。
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../../../..');
const planning = path.resolve(web, '../damage_viewer_project_planning');
const prefix = '数据参考/全量录入-2026-09/';
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const skill = '/skills/annie_e';
const route = `${skill}/trigger-rules`;
const detailRoute = `${route}/on_used_self_shield`;
const kinds = [['parameters', 'parameterKey'], ['formulas', 'formulaKey'], ['effects', 'effectKey'], ['processes', 'processKey'], ['internal-states', 'stateKey'], ['trigger-rules', 'ruleKey']];
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const fileHash = name => sha(fs.readFileSync(path.join(here, name)));
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const save = (name, value) => fs.writeFileSync(path.join(here, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
const strip = value => Array.isArray(value) ? value.map(strip) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !['createdAt', 'updatedAt', 'gameId', 'skillKey'].includes(key)).map(([key, item]) => [key, strip(item)])) : value;
const requestBody = {
  ruleKey: 'on_used_self_shield', name: '主动自施熔岩护盾',
  description: '安妮E主动使用且回退前的显式目标为来源对象时，执行已有自身护盾。无显式目标不匹配；队友、提伯斯、反伤、移速、资源及冷却不在本条规则内。',
  sortOrder: 10,
  eventSource: {eventType: 'SKILL_USED', detail: {sourceSkillKey: 'annie_e', useKind: 'ACTIVE'}},
  conditionGroups: [{groupKey: 'self_cast', name: '明确对自身施放', sortOrder: 10,
    conditions: [{conditionKey: 'explicit_self', conditionType: 'EXPLICIT_TARGET_IS_SOURCE', sortOrder: 10, detail: {}}]}],
  actions: [{actionKey: 'apply_self_shield', name: '执行熔岩自护盾', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
    targetContext: 'CURRENT_TARGET', detail: {effectKey: 'molten_shield'}, runtimeInputBindings: [], resultModifiers: []}],
  perTargetCooldown: null, maxTriggersPerProcess: null
};
function sources() {
  const paths = [
    [planning, prefix + '英雄/原始资料/zh_CN/champion/Annie.json'],
    [planning, prefix + '英雄/原始资料/en_US/champion/Annie.json'],
    [planning, prefix + '技能公共参数实录/客户端原文/Annie.json.gz'],
    [web, prefix + '交叉试录/Cursor/英雄机制第二批/录入候选.json'],
    [web, prefix + '交叉试录/Cursor/英雄机制第二批/来源冻结/annie-来源与哈希.json']
  ];
  const files = paths.map(([root, relativePath]) => ({root: root === web ? 'web' : 'planning', relativePath, sha256: sha(fs.readFileSync(path.join(root, relativePath)))}));
  const official = paths.slice(0, 2).map(([root, p]) => {
    const value = JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
    assert.equal(value.version, '16.17.1');
    return {version: value.version, spell: value.data.Annie.spells.find(s => s.id === 'AnnieE')};
  });
  assert.match(official[0].spell.description, /为安妮或一名友军/);
  assert.match(official[1].spell.description, /Annie or an ally/);
  const bytes = zlib.gunzipSync(fs.readFileSync(path.join(paths[2][0], paths[2][1])));
  const objectPath = 'Characters/Annie/Spells/AnnieEAbility/AnnieE';
  const client = JSON.parse(bytes)[objectPath];
  assert(client, '缺少客户端安妮E主对象');
  return {files, official, client: {objectPath, decompressedSha256: sha(bytes), object: client},
    boundary: '固定客户端16.17与官方16.17.1；本批只新增显式自施护盾入口，不证明宿主供值或战斗运行。'};
}
function client() {
  const token = crypto.randomUUID(); // 本地联调非空值，不记录或输出。
  const audit = [];
  async function request(p, method = 'GET', body) {
    assert(method === 'GET' || (process.argv[2] === 'write' && method === 'POST' && p === route));
    if (method !== 'GET') assert.deepEqual(body, requestBody);
    const r = await fetch(base + p, {method, headers: {Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(30000)});
    const data = await r.json(); audit.push({method, path: p, status: r.status});
    return {status: r.status, data};
  }
  async function get(p, status = 200) {const r = await request(p); assert.equal(r.status, status, p); return r.data;}
  return {request, get, audit};
}
async function snapshot(api) {
  const values = {};
  for (const p of [skill, '/characters/champion_annie', '/characters/champion_annie/attributes',
    '/character-skill-relations?characterKey=champion_annie', '/character-skill-relations?skillKey=annie_e',
    '/characters/champion_annie/representative-image', `${skill}/representative-image`]) values[p] = await api.get(p);
  for (const [kind, key] of kinds) {
    const p = `${skill}/${kind}`, list = await api.get(p);
    assert(Array.isArray(list), p); values[p] = list;
    assert.equal(new Set(list.map(row => row[key])).size, list.length, '列表稳定键重复');
    for (const row of list) values[`${p}/${row[key]}`] = await api.get(`${p}/${row[key]}`);
  }
  return values;
}
function checkBefore(values) {
  assert.deepEqual(values[route], []);
  const effect = values[`${skill}/effects/molten_shield`];
  assert.equal(effect.results.length, 1);
  assert.equal(effect.results[0].resultType, 'NORMAL_SHIELD');
  assert.equal(effect.results[0].target, 'SOURCE');
  assert.deepEqual(effect.results[0].valueRule.value, {kind: 'FORMULA', formulaKey: 'shield'});
  assert.equal(effect.lifecycle.instanceScope, 'SOURCE');
  assert.deepEqual(effect.lifecycle.durationValue, {kind: 'PARAMETER', parameterKey: 'shield_duration_ms'});
  assert.equal(effect.lifecycle.periodicIntervalValue, null);
  assert.equal(values[`${skill}/parameters/shield_duration_ms`].fixedValue, 3000);
  assert.equal(values[`${skill}/representative-image`].image.enabled, true);
}
const mode = process.argv[2];
if (mode === 'prepare') {
  for (const f of ['02-冻结请求.json', '03-来源快照.json', '04-写入前现值.json']) assert(!fs.existsSync(path.join(here, f)), '拒绝覆盖：' + f);
  const source = sources(), api = client(), values = await snapshot(api);
  checkBefore(values); await api.get(detailRoute, 404);
  save('03-来源快照.json', source);
  save('04-写入前现值.json', {capturedAt: new Date().toISOString(), base, values, audit: api.audit, businessWrites: 0});
  save('02-冻结请求.json', {sourceVersion: '客户端16.17/官方16.17.1', base, requests: [{method: 'POST', route, detailRoute, body: requestBody}],
    sourceFileSha256: fileHash('03-来源快照.json'), baselineFileSha256: fileHash('04-写入前现值.json')});
  console.log(JSON.stringify({status: 'READY_FOR_REVIEW', GETs: api.audit.length, frozenFileSha256: fileHash('02-冻结请求.json')}));
} else if (mode === 'preflight' || mode === 'write') {
  const review = read('05-独立评审.json'); assert.equal(review.status, 'APPROVED');
  for (const f of ['批次执行.mjs', '01-来源方案.md', '02-冻结请求.json', '03-来源快照.json', '04-写入前现值.json']) assert.equal(fileHash(f), review.approvedFiles[f], '评审散列漂移：' + f);
  assert.deepEqual(sources(), read('03-来源快照.json'));
  const frozen = read('02-冻结请求.json');
  assert.equal(frozen.sourceFileSha256, fileHash('03-来源快照.json'));
  assert.equal(frozen.baselineFileSha256, fileHash('04-写入前现值.json'));
  assert.deepEqual(frozen.requests, [{method: 'POST', route, detailRoute, body: requestBody}]);
  const api = client(), values = await snapshot(api); checkBefore(values);
  assert.deepEqual(values, read('04-写入前现值.json').values, '受保护现值漂移');
  await api.get(detailRoute, 404);
  if (mode === 'preflight') {
    console.log(JSON.stringify({status: 'PASS', GETs: api.audit.length, businessWrites: 0}));
  } else {
    assert.equal(process.env.DAMAGE_APPROVED_BATCH_SHA, fileHash('02-冻结请求.json'), '必须显式提供获批文件散列');
    const report = {startedAt: new Date().toISOString(), status: 'STARTED', approvedFiles: review.approvedFiles, writesAttempted: 0};
    save('06-写入与即时回读.json', report); // 首写前独占创建，任何不确定结果均禁止重放。
    const persist = () => fs.writeFileSync(path.join(here, '06-写入与即时回读.json'), JSON.stringify(report, null, 2) + '\n');
    try {
      report.writesAttempted = 1; persist();
      const response = await api.request(route, 'POST', requestBody);
      report.response = response; persist(); assert.equal(response.status, 201);
      const actual = await api.get(detailRoute); assert.deepEqual(strip(actual), requestBody);
      report.immediateReadback = actual; report.status = 'PASS';
    } catch (error) {report.status = 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY'; report.error = error.message; throw error;}
    finally {report.finishedAt = new Date().toISOString(); report.audit = api.audit; persist();}
    console.log(JSON.stringify({status: report.status, writes: 1, immediateReadback: true}));
  }
} else throw new Error('用法：node 批次执行.mjs prepare|preflight|write');

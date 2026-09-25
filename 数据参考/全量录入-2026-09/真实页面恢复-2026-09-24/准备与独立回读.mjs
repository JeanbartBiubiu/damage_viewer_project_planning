import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// 本批仅允许 GET；业务变更由指定执行代理在真实页面完成。
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const requestedMode = process.argv[2];
const mode = requestedMode === 'readback-neeko-draft-return' ? 'readback-all' : requestedMode;
assert(['prepare', 'readback-kai', 'readback-kai-final', 'readback-neeko-effect', 'readback-all'].includes(mode));
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = crypto.randomUUID();
const audit = [];
const values = {};
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const save = (name, value) => fs.writeFileSync(path.join(here, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function get(route, allowed = [200]) {
  assert(route.startsWith('/') && !route.includes('..'));
  const response = await fetch(base + route, { method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  audit.push({ method: 'GET', route, status: response.status });
  assert(allowed.includes(response.status), route + ': ' + response.status);
  const value = response.status === 404 ? { http: 404 } : await response.json();
  values[route] = value;
  return value;
}
const kinds = { parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey', processes: 'processKey', 'internal-states': 'stateKey', 'trigger-rules': 'ruleKey' };
async function snapshot() {
  for (const skill of ['rune_9111_passive', 'neeko_e']) {
    const prefix = '/skills/' + skill;
    await get(prefix);
    for (const [kind, key] of Object.entries(kinds)) {
      const list = await get(prefix + '/' + kind);
      assert(Array.isArray(list));
      for (const item of list) await get(prefix + '/' + kind + '/' + item[key]);
    }
    await get(prefix + '/representative-image');
  }
  for (const route of ['/runes/rune_9111', '/rune-skill-relations?runeKey=rune_9111', '/character-skill-relations?skillKey=neeko_e', '/runes/rune_9111/representative-image', '/statuses', '/level-config', '/vamp-rules']) await get(route);
  for (const route of ['/skills/neeko_e/effects/first_contact_root', '/skills/neeko_e/trigger-rules/apply_root_on_first_contact']) if (!Object.hasOwn(values, route)) await get(route, [404]);
}
const effectRoute = '/skills/rune_9111_passive/effects/triumph_heal';
const clean = value => {
  const { gameId, skillKey, createdAt, updatedAt, ...body } = value;
  return body;
};
await snapshot();
if (mode === 'prepare') {
  const sourcePath = '数据参考/全量录入-2026-09/妮蔻E首次接触禁锢返回/01-首次页面专用候选.json';
  const candidate = JSON.parse(fs.readFileSync(path.join(root, sourcePath), 'utf8'));
  const sources = candidate.basis.map(source => {
    const actual = hash(fs.readFileSync(path.join(root, source.path)));
    assert.equal(actual, source.sha256, '来源变化：' + source.path);
    return { ...source, verified: true };
  });
  assert.deepEqual(values['/skills/neeko_e/parameters/min_root_duration_ms'].levelValues, candidate.parameter.levels);
  assert.equal(values['/skills/neeko_e/effects/first_contact_root'].http, 404);
  assert.equal(values['/skills/neeko_e/trigger-rules/apply_root_on_first_contact'].http, 404);
  assert(values['/skills/rune_9111_passive/trigger-rules/on_champion_kill']);
  const kai = clean(structuredClone(values[effectRoute]));
  delete kai.effectKey;
  kai.description = '严格一对一范围内，由击杀英雄规则触发，按来源对象5%已损生命值与2.5%最大生命值之和治疗技能拥有者。规则动作的当前目标用于事件上下文，治疗结果仍作用于来源对象；多人助攻和金币分支不在本轮范围。';
  const rule = { ...candidate.rule, oncePerUse: null };
  save('01-写前现值.json', { at: new Date().toISOString(), base, businessWrites: 0, audit, values });
  save('02-批准范围.json', {
    at: new Date().toISOString(), executionMode: 'PLAYWRIGHT_UI_ONLY', model: 'gpt-6-luna', effort: 'max', contextConfigured: 600000, contextUsableAccepted: 570000,
    questions: ['凯旋动作目标与治疗承受者的页面含义及旧说明是否一致', '妮蔻E首次接触与敌方英雄、同次阻挡及已有实例条件能否清楚组合'],
    sources, candidatePath: sourcePath, candidateSha256: hash(fs.readFileSync(path.join(root, sourcePath))),
    baselineSha256: hash(fs.readFileSync(path.join(here, '01-写前现值.json'))),
    allowedRequests: [
      { method: 'PUT', route: effectRoute, body: kai, purpose: '只纠正过时说明，全部数值、结果、公式、目标和关联保持' },
      { method: 'POST', route: '/skills/neeko_e/effects', body: candidate.effect, purpose: '首次接触最短禁锢正式页面返回' },
      { method: 'POST', route: '/skills/neeko_e/trigger-rules', body: rule, purpose: '连接首次接触、未阻挡、敌方英雄及无本来源实例资格' }
    ],
    arithmetic: { neekoDurationMs: [700, 900, 1100, 1300, 1500], triumphAt2000Max1000Missing: 100 },
    wholeSkillComplete: false, runtimeValidated: false
  });
  console.log(JSON.stringify({ status: 'PREPARED', GETs: audit.length, businessWrites: 0, plannedPageSaves: 3 }));
} else {
  const before = read('01-写前现值.json');
  const plan = read('02-批准范围.json');
  assert.equal(hash(fs.readFileSync(path.join(here, '01-写前现值.json'))), plan.baselineSha256);
  const expectedKai = { effectKey: 'triumph_heal', ...plan.allowedRequests[0].body };
  assert.deepEqual(clean(values[effectRoute]), expectedKai);
  for (const field of ['gameId', 'skillKey', 'createdAt']) assert.equal(values[effectRoute][field], before.values[effectRoute][field], '凯旋身份或创建时间变化：' + field);
  const changedCollections = new Set(['/skills/rune_9111_passive/effects']);
  const changedDetails = new Set([effectRoute]);
  if (mode === 'readback-all' || mode === 'readback-neeko-effect') {
    const effect = '/skills/neeko_e/effects/first_contact_root';
    assert.deepEqual(clean(values[effect]), plan.allowedRequests[1].body);
    assert.equal(values[effect].gameId, 'lol');
    assert.equal(values[effect].skillKey, 'neeko_e');
    changedDetails.add(effect);
    changedCollections.add('/skills/neeko_e/effects');
    if (mode === 'readback-all') {
      assert.deepEqual(values[effect], read('14-妮蔻效果独立回读.json').values[effect], '规则新增时原禁锢效果含时间戳发生变化');
      const rule = '/skills/neeko_e/trigger-rules/apply_root_on_first_contact';
      const expectedRule = structuredClone(plan.allowedRequests[2].body);
      // SKILL_HIT 与 SKILL_USED 共用服务端明细类型；GET 固定序列化未使用的 useKind:null。
      // 只接受已由旧规则现场与 SkillTriggerSkillEventDetail 核实的这一处差异，批准 POST 原文不变。
      assert.equal(expectedRule.eventSource.eventType, 'SKILL_HIT');
      assert.equal(Object.hasOwn(expectedRule.eventSource.detail, 'useKind'), false);
      assert.equal(values['/skills/neeko_e/trigger-rules/actual_hit'].eventSource.detail.useKind, null);
      expectedRule.eventSource.detail.useKind = null;
      assert.deepEqual(clean(values[rule]), expectedRule);
      changedDetails.add(rule);
      changedCollections.add('/skills/neeko_e/trigger-rules');
    }
  }
  if (mode !== 'readback-kai') {
    const supplement = read('06-凯旋主体说明补充批准.json');
    assert.deepEqual(clean(values[supplement.route]), supplement.body);
    for (const field of ['gameId', 'skillKey', 'createdAt']) assert.equal(values[supplement.route][field], supplement.before[field], '凯旋主体身份或创建时间变化：' + field);
    changedDetails.add(supplement.route);
  }
  let protectedResponses = 0;
  for (const [route, old] of Object.entries(before.values)) {
    if (changedDetails.has(route)) continue;
    if (changedCollections.has(route)) {
      const skill = route.split('/')[2];
      const key = route.endsWith('/effects') ? 'effectKey' : 'ruleKey';
      const expected = old.map(item => {
        if (skill === 'rune_9111_passive' && item.effectKey === 'triumph_heal') return { ...item, description: expectedKai.description, updatedAt: values[effectRoute].updatedAt };
        return item;
      });
      const actual = values[route].filter(item => !(skill === 'neeko_e' && ['first_contact_root', 'apply_root_on_first_contact'].includes(item[key])));
      assert.equal(values[route].length, old.length + (skill === 'neeko_e' ? 1 : 0), '列表新增数量异常：' + route);
      assert.deepEqual(actual, expected, '列表旧项变化：' + route);
      continue;
    }
    assert.deepEqual(values[route], old, '受保护响应变化：' + route);
    protectedResponses++;
  }
  if (requestedMode === 'readback-neeko-draft-return') {
    assert.deepEqual(values, read('04-本批独立回读.json').values, '未保存草稿验证后实际数据含时间戳变化');
  }
  const name = requestedMode === 'readback-neeko-draft-return' ? '18-妮蔻草稿返回独立回读.json'
    : mode === 'readback-kai' ? '03-凯旋独立回读.json'
    : mode === 'readback-kai-final' ? '10-凯旋主体独立回读.json'
      : mode === 'readback-neeko-effect' ? '14-妮蔻效果独立回读.json' : '04-本批独立回读.json';
  save(name, { status: 'PASS', at: new Date().toISOString(), businessWrites: 0, protectedResponses, audit, values, scope: mode, runtimeValidated: false });
  console.log(JSON.stringify({ status: 'PASS', scope: mode, GETs: audit.length, protectedResponses, businessWrites: 0 }));
}

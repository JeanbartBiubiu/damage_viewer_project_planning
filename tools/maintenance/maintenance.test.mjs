import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, basename } from 'node:path';
import { validateCandidate, candidateSnapshot, operationRequests, operationsForBatch, stableCandidateDependencies, previewUpdates } from './candidate.mjs';
import { sha256, digestJson, canonical, containedFile } from './artifacts.mjs';
import { signReceipt, validationPayload, verifyDatabaseInputs, candidateExpectation } from './verify-candidate.mjs';
import { makeClient, validateBase, applyCandidate, reconcileCandidate } from './client.mjs';
import { collectSavedScenes } from './collect-saved-scenes.mjs';
import { verifyWebhook, feedbackTask, enqueueFeedback, validateResult, processJob, verifyAcceptance, publishReply } from './feedback.mjs';
import { publicRoutes, renderNginx } from './generate-nginx.mjs';
import { buildSkillPlanItem } from '../../.agents/skills/damage-api-authoring/scripts/apply-skill-plan.mjs';

const id = '0f053196-ddbb-4e83-9a77-818c51b21268';
const hash = 'a'.repeat(64);
test('候选独立预期可直接复用于保存后命令行对照且拒绝差异', t => {
  const directory = temporary(t), expected = resolve(directory, 'expected.json'), actual = resolve(directory, 'actual.json');
  writeFileSync(expected, JSON.stringify(candidateExpectation(fixture())));
  writeFileSync(actual, JSON.stringify({ cases: [{ id: 'normal', file: 'result.json' }] }));
  const tool = resolve(import.meta.dirname, '../../.agents/skills/skill-damage-verification/scripts/verify-damage.mjs');
  writeFileSync(resolve(directory, 'result.json'), JSON.stringify({ done: { damage: 100 } }));
  const compare = output => spawnSync(process.execPath, [tool, 'compare', '--expected', expected, '--actual', actual,
    '--output', resolve(directory, output)], { encoding: 'utf8', windowsHide: true });
  assert.equal(compare('passed.json').status, 0);
  writeFileSync(resolve(directory, 'result.json'), JSON.stringify({ done: { damage: 101 } }));
  assert.equal(compare('failed.json').status, 1);
});
function fixture() {
  const before = { skill: { gameId: 'lol', skillKey: 'q', name: '原技能', description: null, sortOrder: 0,
    maxLevel: 1, status: 'ENABLED', skillCategoryKeys: [] }, parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [], baseDigest: hash };
  const expected = structuredClone(before); expected.skill.description = '依据已核对的说明';
  const request = { baseDigest: hash, skill: { name: expected.skill.name, description: expected.skill.description, sortOrder: 0,
    maxLevel: 1, status: 'ENABLED', skillCategoryKeys: [] }, changes: [] };
  return { version: 'maintenance-candidate-v1', batchId: id, principalId: id, gameId: 'lol', reference: 'test/feedback#1',
    sourceRevision: 'revision-1', baselineDigest: hash,
    skillPlan: { schemaVersion: 'skill-configuration-plan-v1', gameId: 'lol', items: [{ skillKey: 'q', before, expected, request,
      sourceEvidence: [{ path: 'source.txt', sha256: sha256('source'), note: '已确认文本' }] }] },
    scenes: [{ id: 'normal', snapshot: { gameId: 'lol', selection: { sourceLevel: 1 }, skillConfigurations: [before],
      executionSkillKeys: ['q'], source: { skillSources: [executionSource('q')] }, target: { skillSources: [] },
      catalogs: { resistance: 10 }, readAt: '2026-11-13T00:00:00Z' }, scenario: { mode: 'fixed' } }],
    expectedPlan: { cases: [{ id: 'normal', inputs: { attack: 80 }, checks: [{ pointer: '/done/damage', expression: '60 + 0.5 * attack', comparison: 'amount' }] }] } };
}
function executionSource(skillKey, active = true) {
  return { skillKey, skillStatus: 'ENABLED', skillLevel: 1, enabled: active,
    inactiveReason: active ? null : 'SCENE_DISABLED' };
}
function temporary(t) {
  const directory = mkdtempSync(resolve(tmpdir(), 'damage-maintenance-test-')), parent = realpathSync(tmpdir());
  t.after(() => { const target = realpathSync(directory); assert.equal(dirname(target), parent); assert.match(basename(target), /^damage-maintenance-test-/); rmSync(target, { recursive: true }); });
  return directory;
}

test('保存后采集复用原场景和独立预期，配置漂移不生成成功计划', async t => {
  const candidate = validateCandidate(fixture()), calls = [], output = resolve(temporary(t), 'saved');
  const client = { request: async (method, path, body) => {
    calls.push({ method, path });
    if (path.endsWith('/baseline')) return { data: { baselineDigest: hash } };
    if (path.endsWith('/configuration')) return { data: candidate.skillPlan.items[0].expected };
    assert.equal(method, 'POST'); assert.ok(path.endsWith('/simulation-snapshot'));
    return { data: { ...candidate.scenes[0].snapshot, selection: JSON.parse(body), skillConfigurations: [candidate.skillPlan.items[0].expected] } };
  } };
  const result = await collectSavedScenes(client, candidate, output);
  assert.equal(result.complete, true); assert.equal(result.scenes, 1);
  assert.deepEqual(JSON.parse(readFileSync(resolve(output, 'expected-plan.json'))), candidate.expectedPlan);
  assert.deepEqual(JSON.parse(readFileSync(resolve(output, 'scenes.json'))).cases[0], { id: 'normal', snapshotFile: 'snapshots/normal.json', mode: 'fixed' });
  assert.ok(calls.every(row => row.method === 'GET' || row.path.endsWith('/simulation-snapshot')));
  const drift = { request: async (_method, path) => ({ data: path.endsWith('/baseline') ? { baselineDigest: hash } : candidate.skillPlan.items[0].before }) };
  await assert.rejects(collectSavedScenes(drift, candidate, resolve(temporary(t), 'drift')), /完整配置与冻结预期不符/);
});
function issue(body = '实际伤害与预期不同。', updatedAt = '2026-11-13T00:00:00Z') {
  return { action: 'opened', repository: { full_name: 'test/feedback' }, sender: { type: 'User' },
    issue: { number: 1, title: '伤害问题', body, updated_at: updatedAt, html_url: 'https://github.com/test/feedback/issues/1' } };
}

test('冻结候选、原始PATCH字节、运行快照和预期分别保留身份', () => {
  const input = fixture(), copy = structuredClone(input), candidate = validateCandidate(input);
  assert.equal(candidate.candidateDigest, digestJson(input));
  assert.equal(operationRequests(candidate)[0].bodySha256, sha256(JSON.stringify(input.skillPlan.items[0].request)));
  assert.deepEqual(operationsForBatch(candidate)[0], { method: 'PATCH', path: '/api/admin/games/lol/skills/q/configuration', bodySha256: operationRequests(candidate)[0].bodySha256 });
  const snapshot = candidateSnapshot(candidate, candidate.scenes[0]);
  assert.equal(snapshot.skillConfigurations[0].skill.description, '依据已核对的说明');
  assert.notEqual(snapshot.snapshotDigest, candidate.scenes[0].snapshot.snapshotDigest);
  assert.deepEqual(input, copy);
});
test('候选改动、缺少场景或预期、未声明修改均被拒绝', () => {
  const candidate = validateCandidate(fixture()); candidate.scenes[0].snapshot.catalogs.resistance = 0;
  assert.throws(() => validateCandidate(candidate), /摘要/);
  for (const mutate of [value => value.scenes = [], value => value.expectedPlan.cases[0].id = 'other',
    value => value.skillPlan.items[0].expected.skill.maxLevel = 2]) {
    const input = fixture(); mutate(input); assert.throws(() => validateCandidate(input));
  }
});
test('改变来源、引用、排序或结构不能沿用旧依赖闭包签发', () => {
  const before = fixture().skillPlan.items[0].before;
  for (const mutate of [value => value.skill.status = 'DISABLED', value => value.skill.maxLevel = 2,
    value => value.skill.sortOrder = 1, value => value.skill.skillCategoryKeys = ['new'], value => value.triggerRules.push({ ruleKey: 'new' })]) {
    const after = structuredClone(before); mutate(after); assert.equal(stableCandidateDependencies(before, after), false);
  }
  const first = structuredClone(before); first.parameters = [{ fixedValue: 10, valueMode: 'FIXED' }];
  const second = structuredClone(first); second.parameters[0].fixedValue = 20;
  assert.equal(stableCandidateDependencies(first, second), false);
  const description = structuredClone(first); description.skill.description = '只修说明';
  assert.equal(stableCandidateDependencies(first, description), true);
});

function developmentFixture() {
  const input = fixture(), item = input.skillPlan.items[0];
  input.version = 'maintenance-development-candidate-v1';
  const parameter = { parameterKey: 'duration_ms', name: '持续毫秒', description: null, sortOrder: 10,
    valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 2000, levelValues: null };
  item.request.changes.push({ objectType: 'PARAMETER', operation: 'CREATE', key: 'duration_ms', value: parameter });
  item.expected.parameters.push({ ...parameter, gameId: 'lol', skillKey: 'q' });
  input.scenes[0].snapshot.references = [executionReference('q')];
  input.scenes[0].previewSnapshot = { ...structuredClone(input.scenes[0].snapshot),
    skillConfigurations: [structuredClone(item.expected)], snapshotDigest: 'b'.repeat(64),
    catalogs: { modifierZones: [{ modifierZoneKey: 'existing_real_zone' }] } };
  return input;
}

function executionReference(sourceSkillKey, targetSkillKey = sourceSkillKey) {
  return { sourceType: 'TRIGGER', sourceSkillKey, sourceKey: 'on_used', fieldPath: 'actions[0].detail.processKey',
    targetType: 'PROCESS', targetSkillKey, targetKey: 'cast', targetSubKey: '' };
}

function modelExecutionFixture(caseKey, skillKeys) {
  const input = fixture();
  const definition = JSON.parse(readFileSync(new URL(`../../web/tests/mechanisms/cases/${caseKey}.json`, import.meta.url), 'utf8'));
  const snapshot = JSON.parse(JSON.stringify(definition.snapshot).replaceAll('mechanism_lab', 'lol'));
  Object.assign(snapshot, { gameId: 'lol', executionSkillKeys: [...skillKeys].sort(), snapshotDigest: hash, readAt: '2026-11-13T00:00:00Z' });
  snapshot.references = snapshot.skillConfigurations.flatMap(configuration => configuration.triggerRules.flatMap(rule =>
    rule.actions.flatMap((action, index) => ['START_PROCESS', 'EXECUTE_EFFECT'].includes(action.actionType) ? [{
      sourceType: 'TRIGGER', sourceSkillKey: configuration.skill.skillKey, sourceKey: rule.ruleKey,
      fieldPath: `actions[${index}].detail.${action.actionType === 'START_PROCESS' ? 'processKey' : 'effectKey'}`,
      targetType: action.actionType === 'START_PROCESS' ? 'PROCESS' : 'EFFECT', targetSkillKey: configuration.skill.skillKey,
      targetKey: action.actionType === 'START_PROCESS' ? action.detail.processKey : action.detail.effectKey, targetSubKey: ''
    }] : [])));
  input.version = 'maintenance-development-candidate-v1';
  input.skillPlan.items = skillKeys.map(skillKey => {
    const before = structuredClone(snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === skillKey));
    before.baseDigest = hash;
    before.skill.description ??= null;
    // 固定数值向量没有要求根集合排序；维护聚合读取按组成稳定键排序。
    for (const [collection, key] of Object.entries({ parameters: 'parameterKey', formulas: 'formulaKey',
      effects: 'effectKey', processes: 'processKey', internalStates: 'stateKey', triggerRules: 'ruleKey' })) {
      before[collection].sort((a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
    }
    const expected = structuredClone(before); expected.skill.description = '依据已确认说明修订';
    return buildSkillPlanItem(before, expected, input.skillPlan.items[0].sourceEvidence);
  });
  snapshot.skillConfigurations = snapshot.skillConfigurations.map(configuration =>
    input.skillPlan.items.find(item => item.skillKey === configuration.skill.skillKey)?.before ?? configuration);
  const previewSnapshot = structuredClone(snapshot);
  previewSnapshot.skillConfigurations = previewSnapshot.skillConfigurations.map(configuration =>
    input.skillPlan.items.find(item => item.skillKey === configuration.skill.skillKey)?.expected ?? configuration);
  input.scenes = [{ id: 'normal', snapshot, previewSnapshot, scenario: { mode: 'fixed' } }];
  return input;
}

function definitionOnlyFixture() {
  const producer = 'lab_shared_window', follower = 'lab_follow_bonus';
  const input = modelExecutionFixture('spell_shield_follow_same_contact_producer_present', [producer, follower]);
  for (const snapshot of [input.scenes[0].snapshot, input.scenes[0].previewSnapshot]) {
    snapshot.executionSkillKeys = [follower];
    snapshot.selection.plannedSkills = snapshot.selection.plannedSkills.filter(plan => plan.skillKey !== producer);
    const setting = snapshot.selection.sourceSkillSettings.find(setting => setting.skillKey === producer);
    setting.enabled = false;
    const source = snapshot.source.skillSources.find(source => source.skillKey === producer);
    Object.assign(source, { enabled: false, inactiveReason: 'SCENE_DISABLED', enabledRuleKeys: [] });
    snapshot.references = [{ sourceType: 'EFFECT', sourceSkillKey: follower, sourceKey: 'extra',
      fieldPath: 'results[0].detail.spellShieldFollowResult.resultKey', targetType: 'RESULT',
      targetSkillKey: producer, targetKey: 'extra', targetSubKey: 'damage' }];
  }
  return input;
}

test('已授权组成删除仅接受开发候选，自动候选继续拒绝结构删除', () => {
  const input = fixture(), item = input.skillPlan.items[0];
  item.before.parameters.push({ gameId: 'lol', skillKey: 'q', parameterKey: 'unused', name: '待清理参数',
    description: null, sortOrder: 0, valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 1, levelValues: null });
  item.request.changes.push({ objectType: 'PARAMETER', operation: 'DELETE', key: 'unused', value: null });
  input.scenes[0].snapshot.references = [executionReference('q')];
  input.scenes[0].previewSnapshot = { ...structuredClone(input.scenes[0].snapshot), skillConfigurations: [structuredClone(item.expected)] };
  input.version = 'maintenance-development-candidate-v1';
  assert.equal(validateCandidate(input).version, 'maintenance-development-candidate-v1');
  const automatic = structuredClone(input);
  automatic.version = 'maintenance-candidate-v1';
  delete automatic.scenes[0].previewSnapshot;
  assert.throws(() => validateCandidate(automatic), /自动候选/);
});

function developmentBatchFixture() {
  const input = developmentFixture(), q = input.skillPlan.items[0], e = structuredClone(q);
  e.skillKey = 'e'; e.before.skill.skillKey = 'e'; e.expected.skill.skillKey = 'e';
  for (const parameter of e.expected.parameters) parameter.skillKey = 'e';
  input.skillPlan.items.push(e);
  const qScene = input.scenes[0];
  qScene.snapshot.skillConfigurations.push(structuredClone(e.before));
  qScene.previewSnapshot.skillConfigurations.push(structuredClone(e.before));
  qScene.snapshot.source.skillSources.push(executionSource('e', false));
  qScene.previewSnapshot.source.skillSources.push(executionSource('e', false));
  const eScene = structuredClone(qScene); eScene.id = 'e_only';
  for (const snapshot of [eScene.snapshot, eScene.previewSnapshot]) {
    snapshot.executionSkillKeys = ['e'];
    snapshot.source.skillSources = [executionSource('q', false), executionSource('e')];
  }
  eScene.snapshot.references = [executionReference('e')];
  eScene.previewSnapshot.references = structuredClone(eScene.snapshot.references);
  eScene.previewSnapshot.skillConfigurations = [structuredClone(q.before), structuredClone(e.expected)];
  input.scenes.push(eScene);
  input.expectedPlan.cases.push({ ...structuredClone(input.expectedPlan.cases[0]), id: eScene.id });
  return input;
}

test('同批技能分别进入场景闭包，预检只更新实际消费项并保留其它完整配置', () => {
  const input = developmentBatchFixture(), copy = structuredClone(input), candidate = validateCandidate(input);
  assert.deepEqual(candidate.scenes.map(scene => previewUpdates(candidate, scene).map(item => item.skillKey)), [['q'], ['e']]);
  assert.equal(operationRequests(candidate).length, 2);
  assert.deepEqual(candidate.scenes[0].previewSnapshot.skillConfigurations[1], input.skillPlan.items[1].before);
  assert.deepEqual(candidate.scenes[1].previewSnapshot.skillConfigurations[0], input.skillPlan.items[0].before);
  assert.deepEqual(input, copy);
});

test('新增自然执行入口由真实预检闭包选择，不要求修前已有相同执行引用', () => {
  const input = developmentFixture();
  input.scenes[0].snapshot.references = [];
  const candidate = validateCandidate(input);
  assert.deepEqual(previewUpdates(candidate, candidate.scenes[0]).map(item => item.skillKey), ['q']);
  const absent = structuredClone(input);
  absent.scenes[0].previewSnapshot.references = [];
  assert.throws(() => validateCandidate(absent), /没有对应的配置变更/);
});

test('未消费技能不能在预检中变化，也不能凭完整配置列表充当变更覆盖', () => {
  const changed = developmentBatchFixture();
  changed.scenes[0].previewSnapshot.skillConfigurations[1] = structuredClone(changed.skillPlan.items[1].expected);
  assert.throws(() => validateCandidate(changed), /未参与本场投影.*完整基线/);
  const uncovered = developmentBatchFixture();
  uncovered.scenes.pop(); uncovered.expectedPlan.cases.pop();
  assert.throws(() => validateCandidate(uncovered), /未被任何候选场景覆盖/);
  for (const references of [undefined, null, {}, [null], [{ sourceSkillKey: 'q' }]]) {
    const missing = developmentFixture(); missing.scenes[0].snapshot.references = references;
    assert.throws(() => validateCandidate(missing), /执行引用/);
  }
});

test('实际技能命中触发另一来源启动自身过程，两者均可贡献执行覆盖', () => {
  const input = modelExecutionFixture('skill_hit_passive_delay_at', ['lab_arc_shot', 'lab_deferred_strike']);
  const candidate = validateCandidate(input);
  const deferred = candidate.scenes[0].previewSnapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === 'lab_deferred_strike');
  const schedule = deferred.triggerRules.find(rule => rule.ruleKey === 'schedule');
  assert.equal(schedule.eventSource.detail.sourceSkillKey, 'lab_arc_shot');
  assert.equal(schedule.actions[0].detail.processKey, 'delayed');
  assert.deepEqual(previewUpdates(candidate, candidate.scenes[0]).map(item => item.skillKey), ['lab_arc_shot', 'lab_deferred_strike']);
});

test('必要定义可完整投影，但开发与自动候选均不能据此授予执行覆盖', () => {
  const input = definitionOnlyFixture();
  assert.deepEqual(previewUpdates(input, input.scenes[0]).map(item => item.skillKey), ['lab_shared_window', 'lab_follow_bonus']);
  assert.throws(() => validateCandidate(input), /未被任何候选场景覆盖/);
  const automatic = structuredClone(input); automatic.version = 'maintenance-candidate-v1';
  delete automatic.scenes[0].previewSnapshot;
  assert.throws(() => validateCandidate(automatic), /未被任何候选场景覆盖/);
});

test('另一场真实启用生产者后可覆盖整批，定义场投影保持完整预期', () => {
  const input = definitionOnlyFixture();
  const executing = modelExecutionFixture('spell_shield_follow_same_contact_producer_present', ['lab_shared_window', 'lab_follow_bonus']).scenes[0];
  executing.id = 'producer_runs'; input.scenes.push(executing);
  input.expectedPlan.cases.push({ ...structuredClone(input.expectedPlan.cases[0]), id: executing.id });
  assert.equal(validateCandidate(input).scenes.length, 2);
});

test('新入口使用修后执行事实，修前为空不限制开发候选', () => {
  const input = developmentFixture(); input.scenes[0].snapshot.executionSkillKeys = [];
  assert.equal(validateCandidate(input).scenes.length, 1);
});

test('本地合法伪造的执行声明仍被独立服务重读拒绝', async () => {
  const original = definitionOnlyFixture(), input = structuredClone(original);
  const preview = input.scenes[0].previewSnapshot;
  preview.executionSkillKeys = ['lab_follow_bonus', 'lab_shared_window'];
  Object.assign(preview.source.skillSources.find(source => source.skillKey === 'lab_shared_window'), { enabled: true, inactiveReason: null });
  const candidate = validateCandidate(input);
  await assert.rejects(verifyDatabaseInputs(candidate, { request: async (_method, path) => ({ data: path.endsWith('/baseline')
    ? { baselineDigest: hash } : { ...(path.endsWith('/simulation-preview') ? original.scenes[0].previewSnapshot : original.scenes[0].snapshot), readAt: 'fresh' } }) }), /预检快照并非当前后端/);
});

test('结构变化必须显式选择开发候选，并保留后端预检的完整派生场景', () => {
  const input = developmentFixture(), candidate = validateCandidate(input);
  assert.deepEqual(candidateSnapshot(candidate, candidate.scenes[0]), input.scenes[0].previewSnapshot);
  assert.deepEqual(previewUpdates(candidate, candidate.scenes[0]), [{ skillKey: 'q', request: input.skillPlan.items[0].request }]);
  const automatic = structuredClone(input); automatic.version = 'maintenance-candidate-v1';
  delete automatic.scenes[0].previewSnapshot;
  assert.throws(() => validateCandidate(automatic), /自动候选/);
  for (const mutate of [value => delete value.scenes[0].previewSnapshot,
    value => value.scenes[0].previewSnapshot.selection.sourceLevel = 2,
    value => value.scenes[0].previewSnapshot.skillConfigurations[0].parameters[0].fixedValue = 9]) {
    const malformed = developmentFixture(); mutate(malformed);
    assert.throws(() => validateCandidate(malformed));
  }
});

test('尚无INITIAL入口时开发候选保留空修前快照与真实后端预检，不补造普通快照', () => {
  const input = developmentFixture(); input.scenes[0].snapshot = null;
  const candidate = validateCandidate(input);
  assert.equal(candidate.scenes[0].snapshot, null);
  assert.deepEqual(candidateSnapshot(candidate, candidate.scenes[0]), input.scenes[0].previewSnapshot);
  assert.deepEqual(previewUpdates(candidate, candidate.scenes[0]), [{ skillKey: 'q', request: input.skillPlan.items[0].request }]);
  const ordinary = fixture(); ordinary.scenes[0].snapshot = null;
  assert.throws(() => validateCandidate(ordinary), /快照/);
  for (const mutate of [value => delete value.scenes[0].snapshot,
    value => value.scenes[0].previewSnapshot.references = [],
    value => value.scenes[0].previewSnapshot.skillConfigurations[0].parameters[0].fixedValue = 999]) {
    const malformed = developmentFixture(); malformed.scenes[0].snapshot = null; mutate(malformed);
    assert.throws(() => validateCandidate(malformed));
  }
});

test('空修前快照的签发核对真实完整before与后端预检，配置或目录漂移均拒绝', async () => {
  const input = developmentFixture(); input.scenes[0].snapshot = null;
  const candidate = validateCandidate(input), calls = [];
  const client = { request: async (method, path, body) => {
    calls.push({ method, path });
    if (method === 'GET' && path.endsWith('/configuration')) return { data: structuredClone(input.skillPlan.items[0].before) };
    if (method === 'GET') return { data: { baselineDigest: hash } };
    assert(path.endsWith('/simulation-preview'), '空修前快照不能被伪装为普通快照成功');
    assert.deepEqual(JSON.parse(body), { selection: input.scenes[0].previewSnapshot.selection, updates: previewUpdates(candidate, candidate.scenes[0]) });
    return { data: { ...input.scenes[0].previewSnapshot, readAt: 'fresh' } };
  } };
  const checked = await verifyDatabaseInputs(candidate, client);
  assert.equal(calls.filter(c => c.path.endsWith('/configuration')).length, 1);
  assert.equal(checked.scenes[0].originalSnapshotUnavailable, true);
  assert.equal(checked.scenes[0].previewSnapshotDigest, 'b'.repeat(64));
  assert.equal(checked.originalConfigurations[0].actual.baseDigest, hash);
  await assert.rejects(verifyDatabaseInputs(candidate, { request: async (...args) => {
    const result = await client.request(...args);
    if (args[1].endsWith('/configuration')) result.data.skill.name = '并行变更';
    return result;
  } }), /完整基线/);
  await assert.rejects(verifyDatabaseInputs(candidate, { request: async (...args) => {
    const result = await client.request(...args);
    if (args[1].endsWith('/configuration')) result.data.baseDigest = 'c'.repeat(64);
    return result;
  } }), /完整基线/);
  const forged = structuredClone(candidate); forged.scenes[0].previewSnapshot.catalogs.modifierZones = [];
  await assert.rejects(verifyDatabaseInputs(forged, client), /后端重建/);
});

test('开发签发独立读取后端预检，伪造目录即使重新冻结仍拒绝', async () => {
  const candidate = validateCandidate(developmentFixture()), paths = [];
  const client = { request: async (method, path, body) => {
    paths.push(path);
    if (method === 'GET') return { data: { baselineDigest: hash } };
    if (path.endsWith('/simulation-preview')) {
      assert.deepEqual(JSON.parse(body), { selection: candidate.scenes[0].snapshot.selection,
        updates: previewUpdates(candidate, candidate.scenes[0]) });
      return { data: { ...candidate.scenes[0].previewSnapshot, readAt: 'fresh' } };
    }
    return { data: candidate.scenes[0].snapshot };
  } };
  const checked = await verifyDatabaseInputs(candidate, client);
  assert.equal(paths.filter(path => path.endsWith('/simulation-preview')).length, 1);
  assert.equal(checked.scenes[0].previewSnapshotDigest, candidate.scenes[0].previewSnapshot.snapshotDigest);
  const forgedInput = developmentFixture();
  forgedInput.scenes[0].previewSnapshot.catalogs.modifierZones[0].modifierZoneKey = 'forged_zone';
  const forged = validateCandidate(forgedInput);
  await assert.rejects(verifyDatabaseInputs(forged, client), /后端重建/);
});
test('相同选择和预检请求在同轮读取一次，签发前后不跨轮复用', async () => {
  const input = developmentFixture();
  input.scenes.push({ ...structuredClone(input.scenes[0]), id: 'same_selection' });
  input.expectedPlan.cases.push({ ...structuredClone(input.expectedPlan.cases[0]), id: 'same_selection' });
  const candidate = validateCandidate(input), paths = [];
  const client = { request: async (method, path) => {
    paths.push(path);
    return { data: method === 'GET' ? { baselineDigest: hash }
      : structuredClone(path.endsWith('/simulation-preview') ? candidate.scenes[0].previewSnapshot : candidate.scenes[0].snapshot) };
  } };
  const first = await verifyDatabaseInputs(candidate, client);
  assert.deepEqual(first.scenes.map(scene => scene.id), ['normal', 'same_selection']);
  assert.equal(paths.filter(path => path.endsWith('/simulation-snapshot')).length, 1);
  assert.equal(paths.filter(path => path.endsWith('/simulation-preview')).length, 1);
  assert.equal(paths.filter(path => path.endsWith('/baseline')).length, 2);
  await verifyDatabaseInputs(candidate, client);
  assert.equal(paths.filter(path => path.endsWith('/simulation-snapshot')).length, 2);
  assert.equal(paths.filter(path => path.endsWith('/simulation-preview')).length, 2);
  assert.equal(paths.filter(path => path.endsWith('/baseline')).length, 4);
});

test('独立验证重新读取完整真实快照，伪造抗性和读取期间漂移失败', async () => {
  const candidate = validateCandidate(fixture());
  const client = { request: async (method) => ({ data: method === 'GET' ? { baselineDigest: hash } : { ...candidate.scenes[0].snapshot, readAt: 'new' } }) };
  await verifyDatabaseInputs(candidate, client);
  const forged = structuredClone(candidate); forged.scenes[0].snapshot.catalogs.resistance = 0;
  await assert.rejects(verifyDatabaseInputs(forged, client), /真实场景/);
  let reads = 0;
  await assert.rejects(verifyDatabaseInputs(candidate, { request: async method => ({ data: method === 'GET'
    ? { baselineDigest: ++reads > 1 ? 'b'.repeat(64) : hash } : candidate.scenes[0].snapshot }) }), /基线/);
});
test('只在启用第2版验签且全部真实对照通过后构造回执', () => {
  const candidate = validateCandidate(fixture()), summary = { complete: true, requested: 1, completed: 1,
    candidateDigest: candidate.candidateDigest, engineDigest: hash, adapterVersion: 'test', authorizationRequired: true, authorizationVersion: 2 };
  const report = { pass: true, cases: [{}] }, payload = validationPayload(candidate, summary, report, hash, 1000);
  assert.equal(payload.expiresAt, 4600); assert.equal(payload.operationsDigest, digestJson(operationsForBatch(candidate)));
  for (const override of [{ complete: false }, { authorizationRequired: false }, { authorizationVersion: 1 }, { completed: 0 }, { candidateDigest: hash }]) {
    assert.throws(() => validationPayload(candidate, { ...summary, ...override }, report, hash));
  }
  assert.throws(() => validationPayload(candidate, summary, { pass: false, cases: [{}] }, hash));
  const key = generateKeyPairSync('ed25519'), receipt = signReceipt(payload, key.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  assert.equal(verify(null, Buffer.from(receipt.payload, 'base64url'), key.publicKey, Buffer.from(receipt.signature, 'base64url')), true);
  assert.equal(verify(null, Buffer.from(`${receipt.payload}x`, 'base64url'), key.publicKey, Buffer.from(receipt.signature, 'base64url')), false);
});
test('只读入口白名单保留必要POST并拒绝配置写入与内部路由', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../server/data_manage/src/main/resources/api-access.json', import.meta.url)));
  const routes = publicRoutes(catalog);
  assert(routes.some(row => row.method === 'POST' && row.path.endsWith('/simulation-snapshot')));
  assert(routes.some(row => row.path === '/api/auth/wasm-grant'));
  assert(!routes.some(row => row.path.startsWith('/internal/') || row.method === 'PATCH' || row.method === 'DELETE' || row.path.includes('last30days')));
  assert(routes.some(row => row.method === 'HEAD' && row.path === '/api/games'));
  const nginx = renderNginx(catalog); assert.match(nginx.maps, /default 0/); assert.match(nginx.gate, /return 403/);
  assert.throws(() => publicRoutes({ version: 1, routes: [{ method: 'POST', path: '/api/admin/games/{gameId}/skills', access: 'PUBLIC_READ' }] }));
});
test('问题事件必须校验原始字节HMAC和仓库，机器人及拉取请求评论不触发', () => {
  const secret = 'x'.repeat(32), bytes = Buffer.from(JSON.stringify(issue())), signature = `sha256=${createHmac('sha256', secret).update(bytes).digest('hex')}`;
  verifyWebhook(bytes, signature, secret);
  assert.throws(() => verifyWebhook(Buffer.from(`${bytes} `), signature, secret));
  assert.throws(() => feedbackTask('issues', issue(), 'other/repository'));
  assert.equal(feedbackTask('issues', { ...issue(), sender: { type: 'Bot' } }, 'test/feedback'), null);
  const pr = issue(); pr.issue.pull_request = {}; assert.equal(feedbackTask('issue_comment', pr, 'test/feedback'), null);
  const ownReply = { ...issue(), action: 'created', comment: { id: 1, updated_at: '2026-11-13T00:00:00Z',
    body: `已处理\n<!-- damage-maintenance:${hash} -->` } };
  assert.equal(feedbackTask('issue_comment', ownReply, 'test/feedback'), null);
});
test('同修订事件去重，旧事件不覆盖较新证据，未解释的问题不能自报解决', t => {
  const directory = temporary(t), first = feedbackTask('issues', issue(), 'test/feedback');
  const queued = enqueueFeedback(directory, first, 'delivery-1'); assert.equal(queued.duplicate, false);
  assert.equal(enqueueFeedback(directory, first, 'delivery-2').duplicate, true);
  const second = feedbackTask('issues', issue('补充证据', '2026-11-13T00:00:01Z'), 'test/feedback');
  enqueueFeedback(directory, second, 'delivery-3');
  enqueueFeedback(directory, first, 'delivery-4');
  assert.equal(JSON.parse(readFileSync(resolve(directory, `${sha256(first.reference)}-latest.json`))).sourceRevision, second.sourceRevision);
  assert.throws(() => validateResult({ sourceRevision: first.sourceRevision, outcome: 'RESOLVED', explanation: '好了' }, first));
  assert.match(feedbackTask('issues', issue('token=private-value Bearer abc123'), 'test/feedback').issue.body, /已移除/);
});
test('过期问题修订在执行前失败，不调用AI进程', async t => {
  const directory = temporary(t), first = feedbackTask('issues', issue(), 'test/feedback'), queued = enqueueFeedback(directory, first, 'delivery-a');
  enqueueFeedback(directory, feedbackTask('issues', issue('新证据', '2026-11-13T00:01:00Z'), 'test/feedback'), 'delivery-b');
  await assert.rejects(processJob({}, directory, queued.id), /修订|变更/);
});
test('维护来源和档案引用拒绝公网明文、凭据URL与路径逃逸', t => {
  assert.equal(validateBase('https://private.example'), 'https://private.example');
  assert.equal(validateBase('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  for (const url of ['http://private.example', 'https://user:pass@example.com', 'https://example.com/api']) assert.throws(() => validateBase(url));
  const directory = temporary(t); writeFileSync(resolve(directory, 'inside'), 'ok');
  assert.equal(containedFile(directory, 'inside'), realpathSync(resolve(directory, 'inside')));
  assert.throws(() => containedFile(directory, '../elsewhere'));
});
test('维护请求遇到网络错误不自动重试，不在错误中回显凭据', async t => {
  const directory = temporary(t);
  let calls = 0;
  const client = makeClient({ apiBase: 'https://private.example', origin: 'https://private.example' }, directory,
    async () => { calls++; throw new Error('sensitive-transport-detail'); });
  await assert.rejects(client.request('PATCH', '/api/admin/games/lol/skills/q/configuration', '{}'), error => !error.message.includes('sensitive-transport-detail') && /不.*重放|禁止.*重放/.test(error.message));
  assert.equal(calls, 1);
});
test('无需会话即可核对维护主体，窗口请求单独携带部署凭据', async t => {
  const directory = temporary(t);
  writeFileSync(resolve(directory, 'deployment-token.txt'), 'fixture-deployment');
  const requests = [];
  const client = makeClient({ apiBase: 'https://private.example', origin: 'https://private.example',
    deploymentTokenFile: 'deployment-token.txt' }, directory, async (url, request) => {
    requests.push({ path: new URL(url).pathname, ...request });
    return new Response(JSON.stringify({ principalId: id, displayName: 'fixture' }));
  });
  assert.equal((await client.principal()).principalId, id);
  await client.request('POST', `/internal/maintenance/batches/${id}/open`, '{}', 'deployment');
  assert.equal(requests[0].path, '/internal/maintenance/me');
  assert.deepEqual(requests[0].headers, { Origin: 'https://private.example', 'X-Damage-Client': 'web' });
  assert.deepEqual(requests[1].headers, { Origin: 'https://private.example', 'X-Damage-Client': 'web',
    'Content-Type': 'application/json', 'X-Damage-Deployment-Token': 'fixture-deployment' });
});
test('已有提交的批次不从头重放', async t => {
  const directory = temporary(t); let calls = 0;
  const client = { request: async () => { calls++; return { data: { state: 'OPEN', nextOperation: 1, operationCount: 1 } }; } };
  await assert.rejects(applyCandidate(client, validateCandidate(fixture()), resolve(directory, 'apply')), /已有提交/);
  assert.equal(calls, 1);
});
test('已解决必须有独立验收签名和真实COMPLETE批次，布尔自报无效', async t => {
  const directory = temporary(t), task = feedbackTask('issues', issue(), 'test/feedback');
  const key = generateKeyPairSync('ed25519');
  writeFileSync(resolve(directory, 'public.der'), key.publicKey.export({ format: 'der', type: 'spki' }));
  let state = 'OPEN';
  let receivedHeaders;
  const server = createServer((request, response) => {
    receivedHeaders = request.headers;
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ batchId: id, state }));
  });
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  t.after(() => new Promise(res => server.close(res)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(resolve(directory, 'client.json'), JSON.stringify({ apiBase: origin, origin: 'https://maintenance.example' }));
  const config = { acceptancePublicKeyFile: 'public.der', publicOrigin: 'https://public.example', maintenanceConfig: 'client.json' };
  const result = { batchId: id, releaseId: 'test-001' }, now = Math.floor(Date.now() / 1000);
  const payload = { version: 'maintenance-public-acceptance-v1', sourceRevision: task.sourceRevision, releaseId: 'test-001', batchId: id,
    publicOrigin: config.publicOrigin, checkedAt: now, expiresAt: now + 3600, outcome: 'PASSED' };
  const signed = signReceipt(payload, key.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  await assert.rejects(verifyAcceptance(config, directory, task, result, { pass: true, publicBrowser: true, batchState: 'COMPLETE' }));
  await assert.rejects(verifyAcceptance(config, directory, task, result, signed), /尚未完成/);
  state = 'COMPLETE'; await verifyAcceptance(config, directory, task, result, signed);
  assert.equal(receivedHeaders['sec-fetch-mode'], undefined);
  assert.equal(receivedHeaders['sec-fetch-site'], undefined);
  assert.equal(receivedHeaders.origin, 'https://maintenance.example');
  const wrong = signReceipt({ ...payload, sourceRevision: 'other' }, key.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  await assert.rejects(verifyAcceptance(config, directory, task, result, wrong), /不属于/);
});
test('反馈回复前重新核对远端修订，变化时不发送评论或关闭请求', async t => {
  const directory = temporary(t), task = feedbackTask('issues', issue(), 'test/feedback'), queued = enqueueFeedback(directory, task, 'delivery-reply');
  const job = resolve(directory, queued.id);
  writeFileSync(resolve(job, 'result.json'), JSON.stringify({ sourceRevision: task.sourceRevision, outcome: 'WAITING_EVIDENCE', explanation: '请补充等级。' }));
  writeFileSync(resolve(job, 'reply.json'), JSON.stringify({ body: '请补充等级。', close: false }));
  writeFileSync(resolve(directory, 'github-token.txt'), 'synthetic-test');
  const methods = [];
  await assert.rejects(publishReply({ githubTokenFile: 'github-token.txt' }, directory, directory, queued.id, async (url, opts) => {
    methods.push(opts.method); return { ok: true, json: async () => ({ ...issue().issue, body: '已补充新证据' }) };
  }), /已经变更/);
  assert.deepEqual(methods, ['GET']);
});
test('旁路reply.close不能把候选或待补证据关闭', async t => {
  for (const outcome of ['CANDIDATE', 'WAITING_EVIDENCE']) {
    const directory = temporary(t), task = feedbackTask('issues', issue(), 'test/feedback'), queued = enqueueFeedback(directory, task, `delivery-${outcome.replaceAll('_', '-')}`);
    const job = resolve(directory, queued.id);
    writeFileSync(resolve(job, 'result.json'), JSON.stringify({ sourceRevision: task.sourceRevision, outcome, explanation: '仍待验证。',
      ...(outcome === 'CANDIDATE' ? { candidateFile: 'candidate.json' } : {}) }));
    writeFileSync(resolve(job, 'reply.json'), JSON.stringify({ body: '旁路关闭', close: true }));
    writeFileSync(resolve(directory, 'github-token.txt'), 'synthetic-test');
    const methods = [];
    await publishReply({ githubTokenFile: 'github-token.txt' }, directory, directory, queued.id, async (url, opts) => {
      methods.push(opts.method);
      return { ok: true, json: async () => opts.method === 'GET' ? issue().issue : { id: 1 } };
    });
    assert.deepEqual(methods, ['GET', 'POST']);
  }
});

test('响应丢失后只读确认真实提交，不再次发送配置请求', async t => {
  const directory = temporary(t), candidate = validateCandidate(fixture());
  let committed = false, writes = 0;
  const calls = [];
  const client = { request: async (method, path) => {
    calls.push(method);
    if (method === 'PATCH') { writes++; committed = true; throw new Error('response unconfirmed'); }
    if (path.endsWith('/baseline')) return { data: { baselineDigest: 'b'.repeat(64) } };
    if (path.includes('/batches/')) return { data: { batchId: id, gameId: 'lol', state: 'OPEN',
      nextOperation: committed ? 1 : 0, operationCount: 1, currentDigest: committed ? 'b'.repeat(64) : hash } };
    return { data: candidate.skillPlan.items[0].expected };
  } };
  await assert.rejects(applyCandidate(client, candidate, resolve(directory, 'attempt')), /unconfirmed/);
  assert.equal(writes, 1);
  calls.length = 0;
  const actual = await reconcileCandidate(client, candidate, resolve(directory, 'readback'));
  assert.equal(actual.allOperationsConfirmed, true);
  assert.equal(actual.confirmedOperations, 1);
  assert.equal(actual.businessWrites, 0);
  assert(calls.every(method => method === 'GET'));
  assert.equal(writes, 1);
});

test('维护超时配置拒绝过小、过大、非整数及文本值', () => {
  for (const requestTimeoutMs of [0, 999, 300001, 1.5, '60000']) {
    assert.throws(() => makeClient({ apiBase: 'http://127.0.0.1:8080', origin: 'https://localhost:5174', requestTimeoutMs }, '.'), /超时/);
  }
});

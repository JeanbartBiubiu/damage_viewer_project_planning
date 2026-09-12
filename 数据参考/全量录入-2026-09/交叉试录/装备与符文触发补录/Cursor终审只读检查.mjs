import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = [
  'README.md',
  '01-合并方案.md',
  '02-合并冻结请求.json',
  '03-来源散列快照.json',
  '04-共享写前现值.json',
  '受保护写入.mjs',
  '独立GET回读.mjs',
  '只读页面验收.mjs'
];
const expectedHashes = {
  'README.md': 'fc7a45179b56a85ba4b9b80b90e1cc16ffa869bb6851ec450cb23539fbf40fa1',
  '01-合并方案.md': 'efeebfb1764462e4daa1d87d2ddaac503a945747a8301ffe790031e79781287c',
  '02-合并冻结请求.json': 'f6c9b114c008d87c909f0ea4c7b91928daf5c4069fabd1b0eec96993b7ea0005',
  '03-来源散列快照.json': '87811d099c41feb51145d58676020dbe787c18bbd60e2f23dea2d28a0bba1243',
  '04-共享写前现值.json': '988cdcc0e19a40aa08f622e014eac24fbb10789bab78cad6e09f9b5e0be5f89a',
  '受保护写入.mjs': '93b445a4b714f794c34a13682b17c0b5de8cac74c503c06aa69606b2e25ad348',
  '独立GET回读.mjs': '86070b7869b70807d2eebb3fb726daa10aa7f40d4ced4a52f3398816e6531871',
  '只读页面验收.mjs': 'a1e98a0be740d9b2ee520d0beafe36a640961fae6140734d8aa6490a4ba2aba3'
};
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
};
const shaValue = (value) => sha256(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
const read = (name) => fs.readFileSync(path.join(here, name));
const text = (name) => read(name).toString('utf8');
const json = (name) => JSON.parse(text(name));
const hashes = Object.fromEntries(files.map((name) => [name, sha256(read(name))]));
assert.deepEqual(hashes, expectedHashes, '八个终审输入散列漂移');

const frozen = json('02-合并冻结请求.json');
const source = json('03-来源散列快照.json');
const baseline = json('04-共享写前现值.json');
assert.equal(frozen.planRevision, 2);
assert.equal(frozen.revision, 'rev2');
assert.equal(frozen.status, 'READY');
assert.equal(frozen.writable, true);
assert.deepEqual(frozen.expectedCurrent, { skillCount: 1062, ruleCount: 96, sourceInitializedCount: 24, finalRuleCount: 100 });
assert.equal(frozen.sourceSnapshotSha256, hashes['03-来源散列快照.json']);
assert.equal(baseline.sourceSnapshotSha256, hashes['03-来源散列快照.json']);
assert.equal(baseline.frozenRequestSha256, hashes['02-合并冻结请求.json']);
assert.equal(source.revision, 'rev2');
assert.equal(baseline.revision, 'rev2');
assert.equal(baseline.businessWrites, 0);
assert.equal(baseline.getCount, 2404);
assert.deepEqual(baseline.statusCounts, { 200: 2400, 404: 4 });
assert.equal(baseline.observedCurrent.skillCount, 1062);
assert.equal(baseline.observedCurrent.ruleCount, 96);
assert.equal(baseline.observedCurrent.sourceInitializedCount, 24);
assert.equal(baseline.stableVerification.stableSkillKeys, true);
assert.equal(baseline.stableVerification.stableRuleKeys, true);
assert.equal(baseline.stableVerification.stableRuleLists, true);
assert.equal(baseline.stableVerification.stableRuleDetails, true);
assert.equal(baseline.preservation.existingRuleCount, 96);
assert.equal(baseline.preservation.existingRuleDetails.length, 96);
assert.equal(baseline.preservation.existingRuleLists.length, 1062);
assert.equal(baseline.targets.length, 4);
assert.deepEqual(baseline.targets.map((target) => target.candidateDetail.status), [404, 404, 404, 404]);

const expected = {
  black: ['item_3071_passive', 'on_physical_damage_dealt_to_champion', 'DAMAGE_DEALT', 'armor_shred'],
  magic: ['item_3042_passive', 'on_basic_attack_hit_to_champion', 'BASIC_ATTACK_HIT', 'on_hit_damage_from_max_mana'],
  stridebreaker: ['item_6631_active', 'actual_hit', 'SKILL_HIT', 'active_hit'],
  triumph: ['rune_9111_passive', 'on_champion_kill', 'KILL', 'triumph_heal']
};
assert.deepEqual(frozen.requests.map((entry) => entry.id), Object.keys(expected));
for (const entry of frozen.requests) {
  const [skillKey, ruleKey, eventType, effectKey] = expected[entry.id];
  assert.equal(entry.skillKey, skillKey);
  assert.equal(entry.ruleKey, ruleKey);
  assert.equal(entry.method, 'POST');
  assert.equal(entry.expectedStatus, 201);
  assert.equal(entry.route, `/skills/${skillKey}/trigger-rules`);
  assert.equal(entry.detailRoute, `${entry.route}/${ruleKey}`);
  assert.equal(entry.bodySha256, shaValue(entry.body), `冻结请求体散列不符：${entry.id}`);
  assert.equal(entry.body.ruleKey, ruleKey);
  assert.equal(entry.body.eventSource.eventType, eventType);
  assert.deepEqual(entry.body.conditionGroups.flatMap((group) => group.conditions).map((condition) => [condition.conditionType, condition.detail.categories]), [
    ['TARGET_CATEGORY_CHECK', ['CHAMPION']]
  ]);
  assert.deepEqual(entry.body.actions.map((action) => [action.actionType, action.targetContext, action.detail.effectKey, action.runtimeInputBindings, action.resultModifiers]), [
    ['EXECUTE_EFFECT', 'CURRENT_TARGET', effectKey, [], []]
  ]);
  assert.equal(entry.body.perTargetCooldown, null);
  assert.equal(entry.body.maxTriggersPerProcess, null);
}
assert.deepEqual(frozen.requests[0].body.eventSource.detail, { damageTypeKey: 'physics', deliveryKind: 'ANY', originKind: 'ANY' });
assert.deepEqual(frozen.requests[1].body.eventSource.detail, {});
assert.deepEqual(frozen.requests[2].body.eventSource.detail, { sourceSkillKey: 'item_6631_active' });
assert.deepEqual(frozen.requests[3].body.eventSource.detail, {});
const triumph = baseline.targets.find((target) => target.id === 'triumph');
const triumphResult = triumph.components.effects.details
  .find((item) => item.key === 'triumph_heal').response.data.results
  .find((item) => item.resultKey === 'result');
assert.equal(triumphResult.resultType, 'DIRECT_HEAL');
assert.equal(triumphResult.target, 'SOURCE');

const writer = text('受保护写入.mjs');
const readback = text('独立GET回读.mjs');
const browser = text('只读页面验收.mjs');
const writerChecks = {
  explicitWriteSwitch: writer.includes("DAMAGE_ALLOW_BUSINESS_WRITES !== '1'"),
  reportReplayGuard: writer.includes("fs.existsSync(reportPath)"),
  eightReviewedInputs: writer.includes('const reviewedInputFiles = [') && files.every((name) => writer.includes(`'${name}'`)),
  cursorAuditRequired: [
    'auditAvailable', 'runDeltaCount', 'outsideScopeCount', 'runDeltaOutsideScopeCount',
    'allTerminalCallsCompleted', 'anyTruncated', 'approvedInputHashes'
  ].every((needle) => writer.includes(needle)),
  arrayLengthExact: writer.includes('actual.length === expected.length'),
  doublePreflight: writer.includes("scanRules('写入前第一轮')") && writer.includes("scanRules('写入前第二轮')"),
  candidate404: writer.includes("requireStatus(before, 404"),
  onlyFrozenLoop: writer.includes('for (const entry of frozen.requests)'),
  exactPost: writer.includes("request('POST', entry.route, entry.body)"),
  immediateRead: writer.includes("request('GET', candidateRoute)"),
  final100: writer.includes("expectedCurrent.finalRuleCount") && writer.includes("最终规则总数不是 100"),
  finalInit24: writer.includes("最终 SOURCE_INITIALIZED 不是 24"),
  exactFourWrites: writer.includes("report.businessWriteCount, 4") && writer.includes("report.writes.length, 4")
};
assert.equal(Object.values(writerChecks).every(Boolean), true, '写入器静态门禁不完整');

const readbackChecks = {
  onlyGET: !/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)['\"]/.test(readback),
  final100: readback.includes('最终规则总数不是 100'),
  init24: readback.includes('最终 SOURCE_INITIALIZED 不是 24'),
  oldExact: readback.includes('旧规则详情变化'),
  newFrozenMatch: readback.includes('新增规则详情与冻结请求不符'),
  targetNonRuleExact: readback.includes('非规则组成变化')
};
assert.equal(Object.values(readbackChecks).every(Boolean), true, '独立回读静态门禁不完整');

const browserChecks = {
  fourTargets: expectedHashes['只读页面验收.mjs'] === hashes['只读页面验收.mjs'] && ['item_3071_passive', 'item_3042_passive', 'item_6631_active', 'rune_9111_passive'].every((key) => browser.includes(key)),
  exact64: browser.includes('[true, 64, 64]'),
  zeroBusinessWrites: browser.includes("assert.equal(businessWrites, 0"),
  zeroDiagnostics: ['consoleErrors', 'pageErrors', 'requestFailures', 'errorResponses'].every((key) => browser.includes(key)),
  triumphSourceVisible: browser.includes("resultTexts: ['凯旋独立治疗', '直接治疗', '施法者', 'triumph_heal']"),
  triggerSemanticsVisible: ['来源对象造成伤害', '普通攻击命中', '技能命中', '来源对象完成击杀', '事件对方类别', '当前目标'].every((label) => browser.includes(label))
};
assert.equal(Object.values(browserChecks).every(Boolean), true, '页面验收静态门禁不完整');

console.log(JSON.stringify({
  status: 'PASS',
  methodPolicy: 'LOCAL_FILES_READ_ONLY',
  files: hashes,
  frozenRequests: frozen.requests.map((entry) => ({
    id: entry.id,
    skillKey: entry.skillKey,
    ruleKey: entry.ruleKey,
    eventSource: entry.body.eventSource,
    condition: entry.body.conditionGroups[0],
    action: entry.body.actions[0],
    perTargetCooldown: entry.body.perTargetCooldown,
    maxTriggersPerProcess: entry.body.maxTriggersPerProcess
  })),
  baseline: {
    getCount: baseline.getCount,
    statusCounts: baseline.statusCounts,
    skillCount: baseline.observedCurrent.skillCount,
    ruleCount: baseline.observedCurrent.ruleCount,
    sourceInitializedCount: baseline.observedCurrent.sourceInitializedCount,
    stableVerification: baseline.stableVerification,
    oldRuleDetails: baseline.preservation.existingRuleDetails.length,
    candidateStatuses: baseline.targets.map((target) => ({ id: target.id, status: target.candidateDetail.status })),
    triumphResult: { resultType: triumphResult.resultType, target: triumphResult.target }
  },
  writerChecks,
  readbackChecks,
  browserChecks,
  businessWrites: 0
}, null, 2));

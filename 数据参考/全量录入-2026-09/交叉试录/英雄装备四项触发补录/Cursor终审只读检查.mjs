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
  'README.md': '50f9ff5a98500d619eb4ffa25967783ad3d42a054c67067fd7ba029b79136dce',
  '01-合并方案.md': '25e49365814d1a664ccaad6d14540f042e6712ab9f95a1175808e14889026754',
  '02-合并冻结请求.json': 'd47f251e3a5075b63ae935d7dffa5b7e07533395c736db6a513c6e13b304f60b',
  '03-来源散列快照.json': 'e4abeb8ef1e7b2c027e0bef8d810deda2bada284a4f7c108255f587ba047f053',
  '04-共享写前现值.json': 'b7c69ea321cb08075670958b1954c25aff5bb3a8d07f7210d16ddf9556867650',
  '受保护写入.mjs': '3dc6d4f25d9b4d5f5216eba0793ea7afa62685887c89d4d7a7bbf7aed8996d46',
  '独立GET回读.mjs': '75223cd15ae8833ddd69ae97ea4a5104d791ad93ce60420c37ad1bbaec631d0b',
  '只读页面验收.mjs': 'd80e95aed0f7e43faadfb235a016b1c8d65d05615dd867388277d92df4d600cc'
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
const expectedCurrent = { skillCount: 1062, ruleCount: 100, sourceInitializedCount: 24, finalRuleCount: 104 };
assert.equal(frozen.schemaVersion, 2);
assert.equal(frozen.planRevision, 2);
assert.equal(frozen.revision, 'rev2');
assert.equal(frozen.status, 'READY');
assert.equal(frozen.writable, true);
assert.deepEqual(frozen.expectedCurrent, expectedCurrent);
assert.equal(frozen.sourceSnapshotSha256, hashes['03-来源散列快照.json']);
assert.equal(source.revision, 'rev2');
assert.equal(source.status, 'CAPTURED');
assert.equal(baseline.revision, 'rev2');
assert.equal(baseline.status, 'CAPTURED');
assert.equal(baseline.sourceSnapshotSha256, hashes['03-来源散列快照.json']);
assert.equal(baseline.frozenRequestSha256, hashes['02-合并冻结请求.json']);
assert.equal(baseline.businessWrites, 0);
assert.equal(baseline.getCount, 2508);
assert.deepEqual(baseline.statusCounts, { 200: 2500, 404: 8 });
assert.deepEqual(baseline.expectedCurrent, expectedCurrent);
assert.equal(baseline.observedCurrent.skillCount, 1062);
assert.equal(baseline.observedCurrent.ruleCount, 100);
assert.equal(baseline.observedCurrent.sourceInitializedCount, 24);
assert.equal(baseline.stableVerification.stableSkillKeys, true);
assert.equal(baseline.stableVerification.stableRuleKeys, true);
assert.equal(baseline.stableVerification.stableRuleLists, true);
assert.equal(baseline.stableVerification.stableRuleDetails, true);
assert.equal(baseline.preservation.existingRuleCount, 100);
assert.equal(baseline.preservation.existingRuleDetails.length, 100);
assert.equal(baseline.preservation.existingRuleLists.length, 1062);
assert.equal(baseline.targets.length, 4);
assert.deepEqual(baseline.targets.map((target) => target.candidateDetail.status), [404, 404, 404, 404]);

const expected = {
  ashe: {
    skillKey: 'ashe_r', ruleKey: 'actual_hit', eventType: 'SKILL_HIT',
    eventDetail: { sourceSkillKey: 'ashe_r' }, effectKey: 'hit_damage', conditions: 1,
    resultKey: 'damage', resultType: 'DAMAGE', resultTarget: 'TARGET', formulaKey: 'hit_damage'
  },
  nasus: {
    skillKey: 'nasus_e', ruleKey: 'actual_initial_hit', eventType: 'SKILL_HIT',
    eventDetail: { sourceSkillKey: 'nasus_e' }, effectKey: 'initial_damage', conditions: 1,
    resultKey: 'damage', resultType: 'DAMAGE', resultTarget: 'TARGET', formulaKey: 'initial_damage'
  },
  rocket: {
    skillKey: 'item_3152_active', ruleKey: 'actual_hit', eventType: 'SKILL_HIT',
    eventDetail: { sourceSkillKey: 'item_3152_active' }, effectKey: 'firebolt_hit', conditions: 1,
    resultKey: 'damage', resultType: 'DAMAGE', resultTarget: 'TARGET', formulaKey: 'firebolt_damage'
  },
  riven: {
    skillKey: 'riven_e', ruleKey: 'on_used', eventType: 'SKILL_USED',
    eventDetail: { sourceSkillKey: 'riven_e', useKind: 'ACTIVE' }, effectKey: 'shield', conditions: 0,
    resultKey: 'shield', resultType: 'NORMAL_SHIELD', resultTarget: 'SOURCE', formulaKey: 'total_shield'
  }
};
assert.deepEqual(frozen.requests.map((entry) => entry.id), Object.keys(expected));
for (const entry of frozen.requests) {
  const target = expected[entry.id];
  assert.equal(entry.skillKey, target.skillKey);
  assert.equal(entry.ruleKey, target.ruleKey);
  assert.equal(entry.method, 'POST');
  assert.equal(entry.expectedStatus, 201);
  assert.equal(entry.route, `/skills/${target.skillKey}/trigger-rules`);
  assert.equal(entry.detailRoute, `${entry.route}/${target.ruleKey}`);
  assert.equal(entry.bodySha256, shaValue(entry.body), `冻结请求体散列不符：${entry.id}`);
  assert.equal(entry.body.ruleKey, target.ruleKey);
  assert.deepEqual(entry.body.eventSource, { eventType: target.eventType, detail: target.eventDetail });
  const conditions = entry.body.conditionGroups.flatMap((group) => group.conditions);
  assert.equal(conditions.length, target.conditions);
  if (target.conditions === 1) {
    assert.deepEqual(conditions.map((condition) => [condition.conditionType, condition.detail.categories]), [
      ['TARGET_CATEGORY_CHECK', ['CHAMPION']]
    ]);
  } else {
    assert.deepEqual(entry.body.conditionGroups, []);
  }
  assert.deepEqual(entry.body.actions.map((action) => [
    action.actionType,
    action.targetContext,
    action.detail.effectKey,
    action.runtimeInputBindings,
    action.resultModifiers
  ]), [['EXECUTE_EFFECT', 'CURRENT_TARGET', target.effectKey, [], []]]);
  assert.equal(entry.body.perTargetCooldown, null);
  assert.equal(entry.body.maxTriggersPerProcess, null);

  const captured = baseline.targets.find((item) => item.id === entry.id);
  assert(captured, `缺少目标快照：${entry.id}`);
  const formula = captured.components.formulas.details.find((item) => item.key === target.formulaKey)?.response.data;
  const effect = captured.components.effects.details.find((item) => item.key === target.effectKey)?.response.data;
  const result = effect?.results?.find((item) => item.resultKey === target.resultKey);
  assert(formula, `缺少已有公式：${entry.id}`);
  assert(result, `缺少已有结果：${entry.id}`);
  assert.equal(result.resultType, target.resultType);
  assert.equal(result.target, target.resultTarget);
  assert.equal(result.valueRule?.value?.formulaKey, target.formulaKey);
}
const riven = baseline.targets.find((target) => target.id === 'riven');
const rivenEffect = riven.components.effects.details.find((item) => item.key === 'shield').response.data;
assert.equal(rivenEffect.lifecycle.durationValue.parameterKey, 'shield_duration_ms');
assert.equal(rivenEffect.lifecycle.instanceScope, 'SOURCE');
assert.equal(rivenEffect.results[0].detail.absorbedDamageTypeKey, null);
assert.equal(rivenEffect.results[0].detail.decayMode, 'NONE');

const writer = text('受保护写入.mjs');
const readback = text('独立GET回读.mjs');
const browser = text('只读页面验收.mjs');
const writerChecks = {
  explicitWriteSwitch: writer.includes("DAMAGE_ALLOW_BUSINESS_WRITES !== '1'"),
  reportReplayGuard: writer.includes('fs.existsSync(reportPath)'),
  eightReviewedInputs: writer.includes('const reviewedInputFiles = [') && files.every((name) => writer.includes(`'${name}'`)),
  cursorAuditRequired: [
    'auditAvailable', 'runDeltaCount', 'outsideScopeCount', 'runDeltaOutsideScopeCount',
    'allTerminalCallsCompleted', 'anyTruncated', 'approvedInputHashes'
  ].every((needle) => writer.includes(needle)),
  arrayLengthExact: writer.includes('actual.length === expected.length'),
  doublePreflight: writer.includes("scanRules('写入前第一轮')") && writer.includes("scanRules('写入前第二轮')"),
  candidate404: writer.includes("readTarget(target, 404)"),
  onlyFrozenLoop: writer.includes('for (const entry of frozen.requests)'),
  exactPost: writer.includes("request('POST', entry.route, entry.body)"),
  immediateRead: writer.includes("request('GET', entry.detailRoute)"),
  final104: writer.includes('最终规则总数不是104'),
  finalInit24: writer.includes('最终SOURCE_INITIALIZED不是24'),
  exactFourWrites: writer.includes("report.businessWriteCount, 4") && writer.includes("report.writes.length, 4")
};
assert.equal(Object.values(writerChecks).every(Boolean), true, '写入器静态门禁不完整');

const readbackChecks = {
  onlyGET: !/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)['\"]/.test(readback),
  final104: readback.includes('最终规则总数不是104'),
  init24: readback.includes('最终SOURCE_INITIALIZED不是24'),
  oldExact: readback.includes('旧规则详情变化'),
  newFrozenMatch: readback.includes('新增规则详情与冻结请求不符'),
  targetNonRuleExact: readback.includes('非规则组成变化')
};
assert.equal(Object.values(readbackChecks).every(Boolean), true, '独立回读静态门禁不完整');

const browserChecks = {
  fourTargets: ['ashe_r', 'nasus_e', 'item_3152_active', 'riven_e'].every((key) => browser.includes(key)),
  exact64: browser.includes('[true, 64, 64]'),
  zeroBusinessWrites: browser.includes("assert.equal(businessWrites, 0"),
  zeroDiagnostics: ['consoleErrors', 'pageErrors', 'requestFailures', 'errorResponses'].every((key) => browser.includes(key)),
  rivenSourceVisible: ['普通护盾', '施法者', 'total_shield', 'shield_duration_ms'].every((label) => browser.includes(label)),
  triggerSemanticsVisible: ['技能命中', '技能被主动或消耗使用', '事件对方类别', '英雄', '执行效果', '当前目标'].every((label) => browser.includes(label))
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
    bodySha256: entry.bodySha256,
    eventSource: entry.body.eventSource,
    conditionGroups: entry.body.conditionGroups,
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
    rivenShield: {
      resultType: rivenEffect.results[0].resultType,
      target: rivenEffect.results[0].target,
      durationParameter: rivenEffect.lifecycle.durationValue.parameterKey
    }
  },
  writerChecks,
  readbackChecks,
  browserChecks,
  businessWrites: 0
}, null, 2));

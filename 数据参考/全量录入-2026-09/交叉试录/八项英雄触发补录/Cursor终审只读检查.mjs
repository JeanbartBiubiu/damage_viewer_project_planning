import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { expectedCurrent, targetConfigs } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reviewedFiles = [
  '批次配置.mjs',
  '00-独立语义评审.json',
  'README.md',
  '01-合并方案.md',
  '02-合并冻结请求.json',
  '03-来源散列快照.json',
  '04-共享写前现值.json',
  '05-Cursor终审-首版脚本.json',
  '06-首次写入预检失败.json',
  '受保护写入.mjs',
  '独立GET回读.mjs',
  '只读页面验收.mjs'
];
const read = (name) => fs.readFileSync(path.join(here, name));
const text = (name) => read(name).toString('utf8');
const json = (name) => JSON.parse(text(name));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const shaValue = (value) => sha256(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
const equal = (left, right) => isDeepStrictEqual(stable(left), stable(right));
const hashes = Object.fromEntries(reviewedFiles.map((name) => [name, sha256(read(name))]));

const frozen = json('02-合并冻结请求.json');
const source = json('03-来源散列快照.json');
const baseline = json('04-共享写前现值.json');
const semanticReview = json('00-独立语义评审.json');
const priorReview = json('05-Cursor终审-首版脚本.json');
const priorFailure = json('06-首次写入预检失败.json');

assert.equal(semanticReview.verdict, 'REVISE');
assert.equal(semanticReview.businessWrites, 0);
assert.equal(semanticReview.fileWrites, 0);
assert.deepEqual(semanticReview.decision?.writeCandidateIds, targetConfigs.map((target) => target.id));
assert.equal(semanticReview.decision?.expectedRuleCountBefore, expectedCurrent.ruleCount);
assert.equal(semanticReview.decision?.expectedRuleCountAfter, expectedCurrent.finalRuleCount);
assert.deepEqual(semanticReview.deferred?.map((item) => item.id), ['kaisa', 'annie', 'ashe', 'nocturne']);
assert.equal(priorReview.resultStatus, 'finished');
assert.equal(priorReview.verdict, 'READY');
assert.equal(priorReview.reviewedPlanRevision, 3);
assert.equal(priorReview.businessWrites, 0);
assert.equal(priorReview.writeAllowlistAudit?.runDeltaCount, 0);
assert.equal(priorFailure.status, 'FAILED');
assert.equal(priorFailure.businessWriteCount, 0);
assert.equal(priorFailure.writes?.length, 0);
assert.match(priorFailure.error?.message || '', /盖伦 W 缺少效果/);

assert.equal(frozen.schemaVersion, 2);
assert.equal(frozen.planRevision, 4);
assert.equal(frozen.revision, 'rev4');
assert.equal(frozen.status, 'READY');
assert.equal(frozen.writable, true);
assert.deepEqual(frozen.expectedCurrent, expectedCurrent);
assert.equal(frozen.semanticReviewSha256, hashes['00-独立语义评审.json']);
assert.equal(frozen.sourceSnapshotSha256, hashes['03-来源散列快照.json']);
assert.equal(frozen.requests?.length, targetConfigs.length);
assert.equal(frozen.writeBoundary?.businessWriteCount, targetConfigs.length);
assert.deepEqual(frozen.writeBoundary?.methods, ['POST']);
assert.equal(frozen.writeBoundary?.noPutPatchDelete, true);
assert.equal(frozen.writeBoundary?.noReplayIfReportExists, true);

assert.equal(source.schemaVersion, 2);
assert.equal(source.revision, 'rev4');
assert.equal(source.status, 'CAPTURED');
assert.equal(source.methodPolicy, 'LOCAL_FILES_AND_GET_ONLY');
assert.equal(source.semanticReviewSha256, hashes['00-独立语义评审.json']);
assert.equal(source.sourceDirectories?.length, targetConfigs.length);
assert.equal(source.requests?.length, targetConfigs.length);

assert.equal(baseline.schemaVersion, 2);
assert.equal(baseline.revision, 'rev4');
assert.equal(baseline.status, 'CAPTURED');
assert.equal(baseline.businessWrites, 0);
assert.deepEqual(baseline.requestPolicy?.writeMethodsObserved, []);
assert.equal(baseline.semanticReviewSha256, hashes['00-独立语义评审.json']);
assert.equal(baseline.sourceSnapshotSha256, hashes['03-来源散列快照.json']);
assert.equal(baseline.frozenRequestSha256, hashes['02-合并冻结请求.json']);
assert.deepEqual(baseline.expectedCurrent, expectedCurrent);
assert.equal(baseline.observedCurrent?.skillCount, expectedCurrent.skillCount);
assert.equal(baseline.observedCurrent?.ruleCount, expectedCurrent.ruleCount);
assert.equal(baseline.observedCurrent?.sourceInitializedCount, expectedCurrent.sourceInitializedCount);
assert.equal(baseline.stableVerification?.stableSkillKeys, true);
assert.equal(baseline.stableVerification?.stableRuleKeys, true);
assert.equal(baseline.stableVerification?.stableRuleLists, true);
assert.equal(baseline.stableVerification?.stableRuleDetails, true);
assert.equal(baseline.preservation?.existingRuleCount, expectedCurrent.ruleCount);
assert.equal(baseline.preservation?.existingRuleDetails?.length, expectedCurrent.ruleCount);
assert.equal(baseline.preservation?.existingRuleLists?.length, expectedCurrent.skillCount);
assert.equal(baseline.targets?.length, targetConfigs.length);
assert.deepEqual(baseline.targets.map((target) => target.candidateDetail.status), targetConfigs.map(() => 404));

const targetMap = new Map(targetConfigs.map((target) => [target.id, target]));
assert.deepEqual(frozen.requests.map((entry) => entry.id), targetConfigs.map((target) => target.id));
for (const entry of frozen.requests) {
  const target = targetMap.get(entry.id);
  assert(target, '未知目标：' + entry.id);
  assert.equal(entry.skillKey, target.skillKey);
  assert.equal(entry.ruleKey, target.ruleKey);
  assert.equal(entry.method, 'POST');
  assert.equal(entry.route, '/skills/' + target.skillKey + '/trigger-rules');
  assert.equal(entry.detailRoute, entry.route + '/' + target.ruleKey);
  assert.equal(entry.expectedStatus, 201);
  assert.equal(entry.bodySha256, shaValue(entry.body));
  assert.equal(entry.body.ruleKey, target.ruleKey);
  assert.deepEqual(entry.body.eventSource, { eventType: target.eventType, detail: target.eventDetail });
  if (target.conditionKind === 'NONE') {
    assert.deepEqual(entry.body.conditionGroups, []);
  } else {
    assert.equal(entry.body.conditionGroups?.length, 1);
    assert.equal(entry.body.conditionGroups[0].conditions?.length, 1);
    assert.equal(entry.body.conditionGroups[0].conditions[0].conditionType, 'TARGET_CATEGORY_CHECK');
    assert.deepEqual(entry.body.conditionGroups[0].conditions[0].detail?.categories, ['CHAMPION']);
  }
  assert.deepEqual(entry.body.actions.map((action) => action.detail?.effectKey), target.actionEffectKeys);
  for (const action of entry.body.actions) {
    assert.equal(action.actionType, 'EXECUTE_EFFECT');
    assert.equal(action.targetContext, 'CURRENT_TARGET');
    assert.deepEqual(action.runtimeInputBindings, []);
    assert.deepEqual(action.resultModifiers, []);
  }
  assert.equal(entry.body.perTargetCooldown, null);
  assert.equal(entry.body.maxTriggersPerProcess, null);

  const captured = baseline.targets.find((item) => item.id === target.id);
  assert(captured, '共享现值缺少目标：' + target.id);
  assert.equal(captured.candidateDetail.status, 404);
  for (const check of target.effectChecks) {
    const effect = captured.components.effects.details.find((item) => item.key === check.effectKey)?.response.data;
    assert(effect, target.name + ' 缺少效果：' + check.effectKey);
    const result = effect.results?.find((item) => item.resultKey === check.resultKey);
    assert(result, target.name + ' 缺少结果：' + check.resultKey);
    assert.equal(result.target, check.resultTarget);
    assert.equal(result.valueRule?.value?.kind, check.valueKind);
    const actualValueKey = check.valueKind === 'FORMULA' ? result.valueRule?.value?.formulaKey : result.valueRule?.value?.parameterKey;
    assert.equal(actualValueKey, check.valueKey);
    if (check.durationParameterKey) assert.deepEqual(effect.lifecycle?.durationValue, { kind: 'PARAMETER', parameterKey: check.durationParameterKey });
    if (check.absorbedDamageTypeKey) assert.equal(result.detail?.absorbedDamageTypeKey, check.absorbedDamageTypeKey);
  }
}

const writer = text('受保护写入.mjs');
const readback = text('独立GET回读.mjs');
const browser = text('只读页面验收.mjs');
const guardChecks = {
  explicitWriteSwitch: writer.includes("DAMAGE_ALLOW_BUSINESS_WRITES !== '1'"),
  replayLock: writer.includes("fs.existsSync(reportPath)"),
  approvedHashes: writer.includes('approvedInputHashes') && writer.includes('writeAllowlistAudit'),
  terminalCompletion: writer.includes('allTerminalCallsCompleted') && writer.includes('anyTruncated'),
  writerMethodsBounded: writer.includes("if (!['GET', 'POST'].includes(method))"),
  writerEffectChecks: writer.includes('for (const check of config.effectChecks)') && writer.includes('check.absorbedDamageTypeKey'),
  priorFailureBounded: writer.includes("readJson('06-首次写入预检失败.json')") && writer.includes("priorFailure.businessWriteCount, 0"),
  revisedReplayLock: writer.includes("'08-写入与即时回读.json'"),
  exactArrayLength: writer.includes('actual.length === expected.length'),
  readbackGetOnly: readback.includes("'09-独立GET回读.json'") && readback.includes("method: 'GET'") && !readback.includes("method: 'POST'") && !readback.includes("method: 'PUT'") && !readback.includes("method: 'DELETE'"),
  readbackEffectChecks: readback.includes('for (const check of config.effectChecks)') && readback.includes('check.absorbedDamageTypeKey'),
  boundedNullNormalization: readback.includes("eventSource?.eventType === 'SKILL_HIT'") && readback.includes('detail?.useKind === null'),
  browserWriteCount: browser.includes("'10-页面验收.json'") && browser.includes("assert.equal(businessWrites, 0"),
  browserNoTokenLiteral: !browser.includes("damage-viewer.web.admin-token', 'local-entry"),
  browserTargetFilter: browser.includes("targetConfigs.map((target) => target.id)") && browser.includes('页面目标与冻结写入集合不一致')
};
assert.equal(Object.values(guardChecks).every(Boolean), true, '执行脚本门禁不完整');

process.stdout.write(JSON.stringify({
  status: 'READY',
  verdict: 'READY',
  planRevision: 4,
  semanticReview: {
    verdict: semanticReview.verdict,
    accepted: semanticReview.accepted.map(({ id, skillKey, ruleKey, scope, reason }) => ({ id, skillKey, ruleKey, scope, reason })),
    deferred: semanticReview.deferred.map(({ id, skillKey, ruleKey, reason, neededEvidence }) => ({ id, skillKey, ruleKey, reason, neededEvidence })),
    businessWrites: semanticReview.businessWrites,
    fileWrites: semanticReview.fileWrites
  },
  priorAttempt: {
    reviewedPlanRevision: priorReview.reviewedPlanRevision,
    cursorBusinessWrites: priorReview.businessWrites,
    cursorRunDeltaCount: priorReview.writeAllowlistAudit.runDeltaCount,
    preflightStatus: priorFailure.status,
    preflightGetCount: priorFailure.getCount,
    preflightBusinessWrites: priorFailure.businessWriteCount,
    preflightWriteRecords: priorFailure.writes.length,
    error: priorFailure.error.message
  },
  baseline: {
    getCount: baseline.getCount,
    statusCounts: baseline.statusCounts,
    skillCount: baseline.observedCurrent.skillCount,
    ruleCount: baseline.observedCurrent.ruleCount,
    sourceInitializedCount: baseline.observedCurrent.sourceInitializedCount,
    oldRuleDetails: baseline.preservation.existingRuleDetails.length,
    candidateStatuses: baseline.targets.map((target) => ({ id: target.id, status: target.candidateDetail.status }))
  },
  requests: frozen.requests.map((entry) => ({ id: entry.id, route: entry.route, detailRoute: entry.detailRoute, bodySha256: entry.bodySha256 })),
  semanticChecks: Object.fromEntries(targetConfigs.map((target) => [target.id, {
    eventType: target.eventType,
    conditionKind: target.conditionKind,
    actionEffectKeys: target.actionEffectKeys,
    effectChecks: target.effectChecks
  }])),
  guardChecks,
  reviewedFiles,
  approvedInputHashes: hashes,
  businessWrites: 0,
  blockers: [],
  limits: ['静态、GET与管理页面证据不等于宿主事件、战斗运行或Wasm证明。']
}, null, 2));

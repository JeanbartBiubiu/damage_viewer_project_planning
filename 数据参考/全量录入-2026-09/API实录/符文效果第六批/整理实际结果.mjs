import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(here, name)));
const hashFile = name => sha(fs.readFileSync(path.join(here, name)));
const applyFile = 'apply-20260909065941602.json';
const verifyFile = 'verify-20260909070150006.json';
const mathFile = '实值独立核算-20260909070315329.json';
const apply = read(applyFile), verify = read(verifyFile), math = read(mathFile);
const plan = read('最终请求.json'), baseline = read('保护基线.json'), version = read('最终请求版本.json');
const journal = name => fs.readFileSync(path.join(here, name), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const applyLog = journal('流水-20260909065941602.jsonl'), verifyLog = journal('流水-20260909070150006.jsonl'), mathLog = journal('实值核算流水-20260909070315329.jsonl');
function summarizeHTTP(rows) {
  const after = rows.filter(x => x.phase === 'after');
  return { total: after.length, methods: after.reduce((a, v) => (a[v.method] = (a[v.method] || 0) + 1, a), {}), statuses: after.reduce((a, v) => (a[v.status] = (a[v.status] || 0) + 1, a), {}), unknown: rows.filter(v => v.phase === 'unknown' || v.phase === 'failed').length };
}
const applyHTTP = summarizeHTTP(applyLog), verifyHTTP = summarizeHTTP(verifyLog), mathHTTP = summarizeHTTP(mathLog);
assert.equal(apply.summary.passed, true); assert.equal(verify.summary.passed, true); assert.equal(math.summary.passed, true);
assert.equal(apply.summary.writes, 66); assert.equal(apply.summary.reused, 0);
assert.equal(verify.summary.writes, 0); assert.equal(verify.summary.preflightSame, 66);
assert.equal(applyHTTP.unknown + verifyHTTP.unknown + mathHTTP.unknown, 0);
assert.deepEqual(applyHTTP.methods, { GET: 411, POST: 59, PUT: 7 });
assert.deepEqual(verifyHTTP.methods, { GET: 272 }); assert.deepEqual(mathHTTP.methods, { GET: 45 });
assert.ok(verifyLog.filter(v => v.phase === 'after').every(v => v.status === 200));
assert.ok(mathLog.filter(v => v.phase === 'after').every(v => v.status === 200));
assert.equal(hashFile('最终请求.json'), version.requestSha256);
assert.equal(hashFile('最终候选.json'), version.candidateSha256);
assert.equal(hashFile('冻结来源.json'), version.sourceSha256);
assert.equal(hashFile('保护基线.json'), version.baselineSha256);
assert.equal(hashFile('补充饼干消费来源.json'), version.supplementSourceSha256);
const keyCount = rows => rows.reduce((a, r) => (a[r.kind] = (a[r.kind] || 0) + 1, a), {});
assert.deepEqual(keyCount(apply.writes), { skill: 7, parameter: 40, relation: 7, image: 7, formula: 5 });
for (const p of plan.requests) {
  const a = apply.finalReads.find(v => v.route === p.readRoute), b = verify.finalReads.find(v => v.route === p.readRoute);
  assert.ok(a && b && a.matched && b.matched);
  assert.deepEqual(a.actual, b.actual, '两次独立实际GET完整对象不应漂移');
  if (['parameter', 'formula'].includes(p.kind)) {
    const actual = math.reads.find(v => v.route === p.readRoute);
    assert.ok(actual && actual.fullRequestFieldsMatched);
    assert.deepEqual(actual.actual, b.actual, '实值求值所用对象须与独立回读完整同值');
  }
}
assert.equal(verify.collections.length, 42);
assert.equal(verify.collections.reduce((n, v) => n + v.count, 0), 45);
for (const v of verify.collections) if (!['parameters', 'formulas'].includes(v.kind)) assert.equal(v.count, 0);
for (const [route, expected] of [['/runes', baseline.identities], ['/rune-paths', baseline.layouts]]) {
  const rows = verifyLog.filter(v => v.phase === 'after' && v.route === route);
  assert.equal(rows.length, 2);
  for (const row of rows) assert.deepEqual(row.data, expected);
}
assert.equal(baseline.identities.items.length, 69);
assert.equal(baseline.layouts.items.length, 6);
const slots = baseline.layouts.items.flatMap(v => v.slots);
assert.equal(slots.length, 23); assert.equal(slots.reduce((n, v) => n + v.runeKeys.length, 0), 71);
assert.equal(verify.protected.filter(v => v.runeKey).length, 14);
for (const o of baseline.owners) {
  const protectedRows = verify.protected.filter(v => v.runeKey === o.runeKey);
  assert.ok(protectedRows.every(v => v.contentSha256 === o.image.contentSha256 && v.matched));
  const imageUsage = verify.finalReads.find(v => v.kind === 'imageUsages' && v.runeKey === o.runeKey);
  assert.ok(imageUsage.matched);
  const expectedSkill = plan.requests.find(v => v.kind === 'skill' && v.skillKey === o.skillKey).body;
  assert.deepEqual(imageUsage.actual.skills, [...o.usagesBefore.skills, { skillKey: o.skillKey, skillName: expectedSkill.name, skillStatus: expectedSkill.status }]);
  for (const [key, values] of Object.entries(o.usagesBefore)) if (Array.isArray(values) && key !== 'skills') assert.deepEqual(imageUsage.actual[key], values);
}
assert.equal(read('写入启动锁.json').requestSha256, version.requestSha256);
assert.equal(math.math.length, 25); assert.equal(math.negativeControls.length, 5);
assert.ok(math.math.every(v => v.pass)); assert.ok(math.negativeControls.every(v => v.passed));
const completion = {
  at: new Date().toISOString(), status: 'COMPLETE', requestSha256: version.requestSha256,
  candidateSha256: version.candidateSha256, originalSourceSha256: version.sourceSha256,
  writeAttemptCount: 1, writeCount: 66, replayForbidden: true,
  applyReport: applyFile, applyReportSha256: hashFile(applyFile),
  verifyReport: verifyFile, verifyReportSha256: hashFile(verifyFile),
  actualMathReport: mathFile, actualMathReportSha256: hashFile(mathFile),
  boundary: '接口组成录入与独立回读完成；页面由主负责人验收，未宣称完整战斗机制。'
};
fs.writeFileSync(path.join(here, '写入完成锁.json'), JSON.stringify(completion, null, 2) + '\n', { flag: 'wx' });
const result = {
  ...completion,
  writes: { skill: 7, parameter: 40, formula: 5, runeSkillRelation: 7, representativeImageRelation: 7, newImage: 0, reusedImage: 7, reusedExistingRequest: 0, deleted: 0, failed: 0, unknown: 0 },
  http: { apply: applyHTTP, independentVerify: verifyHTTP, actualMath: mathHTTP, afterApplyIndependentGET: verifyHTTP.total + mathHTTP.total },
  fullObjectEquality: { planTargets: 66, sixCollections: 42, actualCompositionDetails: 45, actualMathObjects: 45, matched: true },
  protected: { runeIdentities: 69, layouts: 6, slots: 23, runePositions: 71, representativeImages: 7, imageBytesAndMetadataUnchanged: true, originalUsagesUnchanged: true, newSkillUsages: 7 },
  math: { actualGET: 45, formulas: 5, examples: 25, additionalNegativeControls: 5, passed: true },
  remaining: [
    '7个技能仅含参数及5条独立公式，没有新建效果、过程、内部状态或触发；不计作7个完整战斗机制。',
    '成长生命等级算法、适应属性解析、灵光披风冷却与衰减映射仍需明确运行输入。',
    '多面手去重集合、传说层数进度和基础技能作用范围仍未接线。',
    '饼干食用后5秒持续恢复；出售仅证明永久+30生命。缺血增幅、首跳、永久生命取样顺序仍未猜测。',
    '生命源泉当前等级基础治疗及合法干扰移动事件仍需运行时供值。'
  ],
  fileEvidence: ['最终请求.json', '最终候选.json', '冻结来源.json', '保护基线.json', '补充饼干消费来源.json', '最终独立结论.json', '独立复核/最终独立审查结论.json', applyFile, verifyFile, mathFile].map(file => ({ file, sha256: hashFile(file) }))
};
fs.writeFileSync(path.join(here, '最终实录结果.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, writes: result.writes, independentGET: result.http.afterApplyIndependentGET, reportSha256: hashFile('最终实录结果.json') }));

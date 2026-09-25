import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const read = file => JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'));
const [reportName, outputName, sourceSha] = process.argv.slice(2);
assert(reportName && outputName && /^[0-9a-f]{64}$/.test(sourceSha), '明确提供报告、未使用的证据文件名与最终源码摘要');
assert.equal(path.basename(reportName), reportName); assert.equal(path.basename(outputName), outputName);
const report = read(reportName);
assert.equal(report.stats.expected, 4); assert.equal(report.stats.unexpected, 0); assert.equal(report.stats.skipped, 0);
const sourceBaseline = read('01-普通物理魔法真实伤害实际来源.json');
const runeBaseline = read('08-扩大过滤前独立现值.json');
const host = read('宿主现值核验/适配结果.json');
const expected = { ...sourceBaseline.values, ...runeBaseline.values, '/vamp-rules': host.catalog.find(x => x.route === '/vamp-rules').data };
const specs = suite => [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specs)];
const cases = [], seen = new Set(); let GETs = 0;
for (const spec of report.suites.flatMap(specs)) {
  assert.equal(spec.tests.length, 1); assert.equal(spec.tests[0].results.length, 1);
  const test = spec.tests[0].results[0]; assert.equal(test.status, 'passed');
  const attachment = test.attachments.find(x => x.name === 'source-reviewed-authoring-and-runs');
  const data = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
  assert.equal(data.candidate, true); assert.equal(data.businessWrites, 0); assert.equal(data.runs.length, 4);
  for (const [route, body] of Object.entries(data.snapshots)) {
    assert(Object.hasOwn(expected, route), `未核对来源：${route}`);
    assert.deepEqual(body, expected[route], `真实运行读数与独立现值一致：${route}`); GETs++;
  }
  const skill = data.source.skill.skillKey, rune = data.modifier.skillKey;
  const id = rune === 'rune_8014_passive' ? 8014 : 8017;
  assert(['annie_q', 'garen_r'].includes(skill)); assert(['rune_8014_passive', 'rune_8017_passive'].includes(rune));
  assert(!seen.has(`${skill}/${rune}`)); seen.add(`${skill}/${rune}`);
  const saved = data.snapshots[`/skills/${rune}/effects/basic_attack_health_bonus`];
  const restoredCandidate = structuredClone(data.modifier.effects[0]);
  restoredCandidate.results[0].detail.damageTypeKey = saved.results[0].detail.damageTypeKey;
  restoredCandidate.results[0].detail.deliveryKind = saved.results[0].detail.deliveryKind;
  assert.deepEqual(restoredCandidate, saved, '候选仅调整两项过滤，不删其他配置');
  const runs = data.runs.map(run => {
    assert.equal(run.compiled.ok, true); assert.equal(run.released.released, true);
    assert(run.hiddenDamageRejection.includes('rules.operations'));
    const expectedRaw = skill === 'annie_q' ? 160 : 125 + (1000 - run.hp) / 4;
    const qualified = id === 8014 ? run.hp < 400 : run.hp > 600;
    const damage = expectedRaw * (qualified ? 1.08 : 1) / (skill === 'annie_q' ? 2 : 1);
    const summary = run.done.summary, source = run.owner === 'source';
    assert(Math.abs(summary[source ? 'sourceDamageDealt' : 'targetDamageDealt'] - damage) < 1e-8);
    assert(Math.abs(summary[source ? 'targetFinalHp' : 'sourceFinalHp'] - (run.hp - damage)) < 1e-8);
    assert.equal(summary[source ? 'sourceFinalHp' : 'targetFinalHp'], 900);
    assert.equal(run.done.evidence.items.filter(x => x.kind === 'damage').length, 1);
    const { compileRequest: request, runRequest: runtime, sourceAudit } = run.scenario;
    assert.equal(sourceAudit.facts.length, 1); assert.equal(sourceAudit.facts[0].owner, run.owner);
    assert.equal(sourceAudit.facts[0].skillKey, skill);
    assert.equal(request.rulesHash, runtime.rulesHash); assert.equal(request.rulesHash, runtime.expectedRulesHash);
    assert.equal(request.rulesHash, runtime.initialSnapshot.rulesHash);
    assert(request.rulesHash.startsWith('rules.authored_ordinary_damage.'));
    return { owner: run.owner, receiverHp: run.hp, raw: expectedRaw, expectedDamage: damage,
      ownerHpPreserved: 900, oneDamageInstance: true, unknownDamageRejected: true };
  });
  assert.deepEqual(runs.filter(x => x.owner === 'source').map(x => x.receiverHp), id === 8014 ? [399, 400, 401] : [599, 600, 601]);
  assert.equal(runs.filter(x => x.owner === 'target').length, 1);
  cases.push({ skillKey: skill, runeSkillKey: rune, runs });
}
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const web = 'C:/project/damage_web_dev/web';
assert.equal(sha(path.join(web, 'src/engine/ordinaryDamageSourceAudit.ts')), sourceSha);
assert.equal(sha(path.join(web, 'src/engine/wasm/tinygo_engine_v2.wasm')), '25844991e66d5e189cee0b168869de07c265c5c3cc3336c7b1a9c793ac0d736d');
const files = ['src/engine/ordinaryDamageSourceAudit.ts', 'src/engine/ordinaryDamageSourceAudit.test.ts',
  'src/engine/damageSourceInventory.ts', 'src/engine/damageSourceInventory.test.ts',
  'src/engine/damageModifierAdapter.ts', 'tests/e2e/ordinary-damage-runtime.spec.ts',
  'src/engine/wasm/tinygo_engine_v2.wasm'].map(file => ({ file, sha256: sha(path.join(web, file)) }));
const proof = { at: new Date().toISOString(), status: 'CANDIDATE_RUNTIME_PASSED', runtimeReport: reportName, GETs,
  currentDataMatchesIndependentSnapshots: true, cases, runtimeScenes: cases.reduce((n, x) => n + x.runs.length, 0),
  businessWrites: 0, savedExpandedRuneScope: false, wholeRunesComplete: false, files,
  independentSourceAuditReview: 'Recorded separately before page approval', pageCandidate: '09-扩大过滤页面候选.json' };
fs.writeFileSync(path.join(here, outputName), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ tests: cases.length, runtimeScenes: proof.runtimeScenes, GETs, businessWrites: 0, currentDataMatches: true }));

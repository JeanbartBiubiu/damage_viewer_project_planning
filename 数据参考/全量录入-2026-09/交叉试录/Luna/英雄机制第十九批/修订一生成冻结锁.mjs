import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fileBytes = name => fs.readFileSync(path.join(here, name));
const readJson = name => JSON.parse(fileBytes(name));
const hashFile = name => sha256(fileBytes(name));
const lockName = '修订一冻结候选锁.json';
const archiveName = '修订一冻结原字节';
if (fs.existsSync(path.join(here, lockName))) throw new Error('修订一冻结锁已存在，拒绝覆盖');
if (fs.existsSync(path.join(here, archiveName))) throw new Error('修订一冻结原字节目录已存在，拒绝覆盖');

const candidate = readJson('修订一候选.json');
const version = readJson('修订一候选版本.json');
const plan = readJson('修订一写前计划.json');
const math = readJson('修订一独立源值与算例.json');
const protection = readJson('修订一写前保护.json');
const protectionSummary = readJson('修订一写前保护摘要.json');
const state = readJson('当前候选状态.json');
const originalCandidateSha256 = hashFile('完整候选.json');
const expectedOriginalCandidateSha256 = 'cb3dbab26bc3fc5949d1fbc193ac28da71887f0e743c1ead4885a24fc7739824';
if (originalCandidateSha256 !== expectedOriginalCandidateSha256) throw new Error(`原cb3候选散列变化：${originalCandidateSha256}`);
if (candidate.meta?.apiWrites !== 0 || plan.policy?.businessWrites !== 0 || plan.policy?.apiCalls !== 0 || plan.apiWrites !== 0) throw new Error('修订一文件含业务写入标记');
if (math.failedChecks !== 0 || math.checkCount !== 55) throw new Error('修订一独立核算不是55项全通过');
if (protectionSummary.requestCount !== 188 || protectionSummary.errorCount !== 0 || protectionSummary.apiWrites !== 0) throw new Error('修订一保护不是188次GET全通过');
if (plan.requestCount !== 175 || plan.reusedPublicParameters?.length !== 16) throw new Error('修订一计划不是175新增、16复用');
if (state.businessWrites !== 0 || state.pageAcceptance !== false || state.battleValidation !== false) throw new Error('当前状态不是纯候选阶段');

const kinds = ['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'];
const counts = Object.fromEntries(kinds.map(kind => [kind, Object.values(candidate.skills).reduce((sum, skill) => sum + skill.write[kind].length, 0)]));
const expectedCounts = { parameters: 157, formulas: 26, effects: 8, processes: 0, internalStates: 0, triggerRules: 0 };
if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) throw new Error(`修订一组成计数不符：${JSON.stringify(counts)}`);
if (version.newComponentIntents !== 175 || version.reusedParameters !== 16) throw new Error('修订一版本计数不符');
if (hashFile('修订一候选.json') !== version.fileSha256 || hashFile('修订一候选版本.json') !== plan.candidateVersionFileSha256) throw new Error('修订一候选或版本文件内部散列不一致');
if (version.planSha256 !== plan.candidatePlanSha256) throw new Error('修订一计划语义散列不一致');

const archivePath = path.join(here, archiveName);
fs.mkdirSync(archivePath, { recursive: true });
const archiveSources = [
  ['原候选-cb3-完整候选.json', '完整候选.json'],
  ['修订一候选.json', '修订一候选.json'],
  ['修订一候选版本.json', '修订一候选版本.json'],
  ['修订一写前计划.json', '修订一写前计划.json'],
  ['修订一独立源值与算例.json', '修订一独立源值与算例.json'],
  ['修订一独立源值与算例.txt', '修订一独立源值与算例.txt'],
  ['来源-根绑定与数值证据.json', '根绑定与数值证据.json'],
  ['来源-补充文本证据.json', '补充文本证据.json'],
  ['来源-来源与哈希汇总.json', '来源冻结/来源与哈希汇总.json'],
  ['来源-主技能数值展开.json', '来源冻结/主技能数值展开.json'],
  ['来源-主技能原始展开.json', '来源冻结/主技能原始展开.json'],
];
for (const [archiveFile, sourceFile] of archiveSources) fs.copyFileSync(path.join(here, sourceFile), path.join(archivePath, archiveFile), fs.constants.COPYFILE_EXCL);

const lockedFiles = {};
for (const file of [
  '修订一生成候选.mjs',
  '修订一独立来源与算例.mjs',
  '修订一写前保护.mjs',
  '修订一生成写前计划.mjs',
  '修订一候选.json',
  '修订一候选版本.json',
  '修订一写前保护.json',
  '修订一写前保护摘要.json',
  '修订一写前计划.json',
  '修订一独立源值与算例.json',
  '修订一独立源值与算例.txt',
  '完整候选.json',
  '候选版本.json',
  '独立源值与算例.json',
  '写前现值.json',
  '根绑定与数值证据.json',
  '补充文本证据.json',
  '来源冻结/来源与哈希汇总.json',
  '来源冻结/主技能数值展开.json',
  '来源冻结/主技能原始展开.json',
  '当前候选状态.json',
]) lockedFiles[file] = hashFile(file);
const frozenRawBytes = {};
for (const [archiveFile] of archiveSources) frozenRawBytes[`${archiveName}/${archiveFile}`] = sha256(fs.readFileSync(path.join(archivePath, archiveFile)));

const sourceSummary = readJson('来源冻结/来源与哈希汇总.json');
const lock = {
  at: new Date().toISOString(),
  status: '修订一候选已冻结，等待主负责人审查；不是实录',
  revision: '修订一',
  basedOnCandidateSha256: expectedOriginalCandidateSha256,
  source: 'client16.17/official16.17.1',
  sourceBuild: '16.17.8104348+branch.releases-16-17.content.release',
  candidateFileSha256: hashFile('修订一候选.json'),
  candidatePlanSha256: version.planSha256,
  candidateVersionFileSha256: hashFile('修订一候选版本.json'),
  writePlanFileSha256: hashFile('修订一写前计划.json'),
  independentMathFileSha256: hashFile('修订一独立源值与算例.json'),
  independentMathTextSha256: hashFile('修订一独立源值与算例.txt'),
  protectionFileSha256: hashFile('修订一写前保护.json'),
  protectionSummarySha256: hashFile('修订一写前保护摘要.json'),
  originalSnapshotSha256: hashFile('写前现值.json'),
  counts,
  totalNewRequests: plan.requestCount,
  reusedPublicParameters: plan.reusedPublicParameters.length,
  independentMath: { checks: math.checkCount, passed: math.checkCount - math.failedChecks, failed: math.failedChecks, runtimeInputCount: math.runtimeInputCount },
  api: {
    readOnlyRequests: protectionSummary.requestCount,
    successfulReadOnlyRequests: protectionSummary.statusCounts?.['200'] ?? 0,
    failures: protectionSummary.errorCount,
    businessWrites: 0,
  },
  protectedReadOnly: plan.protectedReadOnly,
  sourceHashes: sourceSummary.heroes.map(hero => ({ id: hero.id, clientSha256: hero.client.sha256, officialSha256: hero.official.sha256 })),
  lockedFiles,
  frozenRawBytes,
  patch: {
    skillKey: 'aatrox_e',
    oldParameterKey: 'bonus_healing_ratio_per_unresolved_stat',
    newParameterKey: 'bonus_healing_ratio_per_bonus_health',
    oldCandidatePreserved: true,
    rootMultiplier: 0.01,
    sourceRatio: 0.011,
    convertedRatioPerBonusHealth: 0.00011,
    formula: '0.16 + 0.00011×SOURCE.hp.BONUS',
    crossSource: '英雄机制第十七批/Vladimir W/TotalDamage；mStat=12,mStatFormula=2,BonusHealthRatio',
  },
  policy: '冻结后禁止覆盖cb3原候选和修订一候选、计划、数学与保护证据；如需再次修订，另存新的修订文件。写入器默认只读，未获主负责人授权不得POST。',
};
const lockBytes = Buffer.from(JSON.stringify(lock, null, 2) + '\n');
fs.writeFileSync(path.join(here, lockName), lockBytes, { flag: 'wx' });
console.log(JSON.stringify({
  lockSha256: sha256(lockBytes),
  candidateFileSha256: lock.candidateFileSha256,
  candidatePlanSha256: lock.candidatePlanSha256,
  candidateVersionFileSha256: lock.candidateVersionFileSha256,
  writePlanFileSha256: lock.writePlanFileSha256,
  independentMathFileSha256: lock.independentMathFileSha256,
  protectionFileSha256: lock.protectionFileSha256,
  totalNewRequests: lock.totalNewRequests,
  reusedPublicParameters: lock.reusedPublicParameters,
  counts,
  readOnlyRequests: lock.api.readOnlyRequests,
  businessWrites: lock.api.businessWrites,
  archivedRawFiles: Object.keys(frozenRawBytes).length,
}, null, 2));

import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('./', import.meta.url);
const readBytes = name => fs.readFileSync(new URL(name, here));
const readJson = name => JSON.parse(readBytes(name));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const candidateBytes = readBytes('完整候选-修订版2.json');
const candidate = JSON.parse(candidateBytes);
const versionBytes = readBytes('候选版本-修订版2.json');
const version = JSON.parse(versionBytes);
const planBytes = readBytes('写前计划-修订版2.json');
const writePlan = JSON.parse(planBytes);
const independentBytes = readBytes('独立源值与算例-修订版2.json');
const independent = JSON.parse(independentBytes);
const evidenceBytes = readBytes('修订组件来源摘要-修订版2.json');
const evidence = JSON.parse(evidenceBytes);
const protectionFile = '关联与图片保护快照-终稿.json';
const protectionBytes = readBytes(protectionFile);
const protection = JSON.parse(protectionBytes);
const sourceBytes = readBytes('来源冻结/来源与哈希汇总.json');
const sourceFreeze = JSON.parse(sourceBytes);
const textEvidence = readJson('补充文本证据.json');
const current = readJson('写前现值.json');
const dedup = readJson('阶段去重预检.json');
const originalLockBytes = readBytes('冻结候选锁-修订版.json');
const originalLock = JSON.parse(originalLockBytes);
const lockFile = new URL('冻结候选锁-修订版2.json', here);
if (fs.existsSync(lockFile)) throw Error('修订版冻结锁已存在，拒绝覆盖');

if (candidate.meta.apiWrites !== 0 || writePlan.policy.businessWrites !== 0 || writePlan.policy.apiCalls !== 0) throw Error('修订候选或写前计划出现业务写入标记');
if (independent.status !== '独立源值、原树映射、手算和负例全部通过；可交父负责人审查' || independent.failures.length) throw Error('修订版独立核算未通过，禁止冻结');
if (!protection.success || protection.summary?.apiWrites !== 0 || protection.failures?.length) throw Error('角色和图片只读保护未通过，禁止冻结');
if (current.summary?.requestCount !== 166 || current.summary?.errorCount !== 0 || !current.requests.every(value => value.status === 200)) throw Error('当前20技能GET证据不是166次全部200');
if (sha(candidateBytes) !== version.fileSha256 || sha(candidateBytes) !== independent.candidateSha256 || sha(candidateBytes) !== writePlan.candidateSha256 || sha(candidateBytes) !== evidence.candidateSha256) throw Error('修订候选关联哈希不一致');
if (candidate.meta.revision?.baseCandidateSha256 !== originalLock.candidateSha256) throw Error('修订版2没有准确指向修订版1冻结候选');

const counts = Object.fromEntries(['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'].map(kind => [kind, Object.values(candidate.skills).reduce((sum, skill) => sum + skill.write[kind].length, 0)]));
const writeIntentCount = Object.values(counts).reduce((sum, value) => sum + value, 0) - 22;
const lock = {
  lockedAt: new Date().toISOString(),
  status: 'READY_FOR_PARENT_REVIEW',
  revision: true,
  historicalLock: { file: '冻结候选锁-修订版.json', sha256: sha(originalLockBytes), candidateSha256: originalLock.candidateSha256 },
  scope: candidate.meta.scope,
  source: 'client16.17/official16.17.1',
  candidateSha256: sha(candidateBytes),
  candidatePlanSha256: version.planSha256,
  candidateVersionSha256: sha(versionBytes),
  writePlanSha256: sha(planBytes),
  independentReportSha256: sha(independentBytes),
  sourceEvidenceSha256: sha(evidenceBytes),
  protectionFile,
  protectionSha256: sha(protectionBytes),
  sourceFreezeSha256: sha(sourceBytes),
  textEvidenceSha256: textEvidence.sha256,
  currentSnapshotSha256: current.snapshotSha256,
  stageLedgerSha256: dedup.ledgerSha256,
  counts,
  reusedPublicParameters: 22,
  writeIntentCount,
  apiWrites: 0,
  businessWrites: 0,
  browserValidation: false,
  runtimeValidation: false,
  protectedScope: { characters: 4, characterSkillRelations: 4, skillImages: 20, apiWrites: 0 },
  replacement: { excluded: 'Veigar', selected: 'Karthus', reason: 'Veigar已有完整六类组成；Karthus仅有公共参数。' },
  revisionChanges: candidate.meta.revision.changes,
  parentAction: '由父负责人审查修订版后决定是否实际保存；本锁不授权任何业务写入。'
};
fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');

const state = {
  at: lock.lockedAt,
  status: lock.status,
  revision: true,
  historicalLock: lock.historicalLock,
  batch: '英雄机制第十六批',
  skills: Object.keys(candidate.skills),
  apiWritesComplete: false,
  businessWrites: 0,
  currentGet: current.summary,
  counts,
  reusedPublicParameters: lock.reusedPublicParameters,
  writeIntentCount,
  exactHashes: { candidate: lock.candidateSha256, candidatePlan: lock.candidatePlanSha256, writePlan: lock.writePlanSha256, independent: lock.independentReportSha256, sourceEvidence: lock.sourceEvidenceSha256, protection: lock.protectionSha256, sourceFreeze: lock.sourceFreezeSha256, currentSnapshot: lock.currentSnapshotSha256, stageLedger: lock.stageLedgerSha256 },
  validation: { sourceAndTree: independent.status, sourceCases: independent.sourceCases.length, manualCases: independent.manualCases.length, negativeControls: independent.negativeControls.length, failures: independent.failures.length, protectedGets: protection.summary },
  limitations: ['尚未业务写入', '尚未浏览器页面验收', '尚未运行时战斗验证', '等级曲线、事件资格、独立召唤物和死亡状态覆盖继续待接线']
};
fs.writeFileSync(new URL('当前实录状态-修订版2.json', here), JSON.stringify(state, null, 2) + '\n');

const artifactDir = 'C:/project/damage_web_dev/.agents/artifacts/hero16-candidate';
fs.mkdirSync(artifactDir, { recursive: true });
const artifact = {
  batch: '英雄机制第十六批',
  revision: true,
  status: lock.status,
  candidates: ['Malzahar', 'Anivia', 'Lissandra', 'Karthus'],
  excluded: [{ hero: 'Veigar', reason: '写前GET已有完整六类组成' }],
  slotCount: Object.keys(candidate.skills).length,
  counts,
  reusedPublicParameters: lock.reusedPublicParameters,
  writeIntentCount,
  apiWrites: 0,
  getEvidence: current.summary,
  exactHashes: state.exactHashes,
  historicalLock: lock.historicalLock,
  parentReviewRequired: true
};
fs.writeFileSync(`${artifactDir}/交付摘要-修订版2.json`, JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify({ status: lock.status, candidateSha256: lock.candidateSha256, counts, reusedPublicParameters: lock.reusedPublicParameters, writeIntentCount, apiWrites: 0, artifact: `${artifactDir}/交付摘要-修订版2.json` }, null, 2));

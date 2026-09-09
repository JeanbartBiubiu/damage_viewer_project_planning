import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('./', import.meta.url);
const read = name => fs.readFileSync(new URL(name, here));
const json = name => JSON.parse(read(name));
const sha = name => createHash('sha256').update(read(name)).digest('hex');
const candidate = json('修订一候选.json');
const plan = json('修订一写前计划.json');
const math = json('修订一独立源值与算例.json');
const diff = json('修订一差异.json');
if (candidate.meta?.apiWrites !== 0 || plan.policy?.businessWrites !== 0 || plan.policy?.apiCalls !== 0 || math.summary?.independentChecks?.failed !== 0) throw Error('修订一不是纯候选阶段。');
if (fs.existsSync(new URL('修订一当前候选状态.json', here))) throw Error('修订一状态已存在，不覆盖。');
const status = {
  generatedAt: new Date().toISOString(),
  phase: '候选',
  status: '修订一候选已准备，等待主负责人审查；不是实录',
  revision: '修订一',
  baseCandidateSha256: candidate.meta.revision.baseCandidateSha256,
  candidateSha256: sha('修订一候选.json'),
  candidatePlanSha256: plan.candidatePlanSha256,
  planFileSha256: sha('修订一写前计划.json'),
  independentMathFileSha256: sha('修订一独立源值与算例.json'),
  diffFileSha256: sha('修订一差异.json'),
  candidateCounts: plan.totalCounts,
  newCounts: plan.counts,
  reusedPublicParameters: plan.reusedPublicParameters.length,
  totalNewRequests: plan.requestCount,
  independentChecks: math.summary.independentChecks,
  protectedReadOnly: {
    requests: plan.currentReadOnly.requests,
    failures: plan.currentReadOnly.failures,
    apiWrites: plan.currentReadOnly.apiWrites,
    publicParameterDetails: plan.protectedReadOnly.publicParameterDetails,
    characters: plan.protectedReadOnly.characters,
    characterSkillRelations: plan.protectedReadOnly.characterSkillRelations,
    representativeImages: plan.protectedReadOnly.representativeImages
  },
  source: 'client16.17/official16.17.1',
  sourceBuild: '16.17.8104348+branch.releases-16-17.content.release',
  businessWrites: 0,
  apiCalls: 0,
  pageAcceptance: false,
  battleValidation: false,
  oldFrozenFilesUntouched: true,
  oldCandidateSha256: diff.base.candidateSha256,
  oldRequestCount: diff.base.requestCount,
  revisedRequestCount: diff.revised.requestCount
};
fs.writeFileSync(new URL('修订一当前候选状态.json', here), JSON.stringify(status, null, 2) + '\n');
console.log(JSON.stringify(status, null, 2));

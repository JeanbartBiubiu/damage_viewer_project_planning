import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('./', import.meta.url);
const candidateFile = '完整候选-修订版.json';
const candidateBytes = fs.readFileSync(new URL(candidateFile, here));
const candidate = JSON.parse(candidateBytes);
const snapshotBytes = fs.readFileSync(new URL('写前现值.json', here));
const snapshot = JSON.parse(snapshotBytes);
const protectionFile = '关联与图片保护快照-终稿.json';
const protectionBytes = fs.readFileSync(new URL(protectionFile, here));
const protection = JSON.parse(protectionBytes);
if (!protection.success || protection.summary?.apiWrites !== 0) throw Error('角色/关系/图片只读保护未成功或出现业务写入');
if (snapshot.summary?.requestCount !== 166 || snapshot.summary?.errorCount !== 0) throw Error('写前GET证据不是166/166成功');

const routes = {
  parameters: 'parameters',
  formulas: 'formulas',
  effects: 'effects',
  processes: 'processes',
  internalStates: 'internal-states',
  triggerRules: 'trigger-rules'
};
const requests = [];
const reused = [];
for (const [skillKey, skill] of Object.entries(candidate.skills)) {
  const reusedSet = new Set(skill.reusedParameters ?? []);
  reused.push(...(skill.reusedParameters ?? []).map(parameterKey => ({ skillKey, parameterKey })));
  for (const [kind, rows] of Object.entries(skill.write)) {
    const routePart = routes[kind];
    if (!routePart) throw Error(`未知组成类别 ${kind}`);
    for (const body of rows) {
      const stableKey = body.parameterKey ?? body.formulaKey ?? body.effectKey ?? body.processKey ?? body.stateKey ?? body.ruleKey;
      if (kind === 'parameters' && reusedSet.has(stableKey)) continue;
      requests.push({ method: 'POST', route: `/skills/${skillKey}/${routePart}`, skillKey, kind, stableKey, body });
    }
  }
}
const counts = Object.fromEntries(Object.keys(routes).map(kind => [kind, requests.filter(row => row.kind === kind).length]));
const report = {
  at: new Date().toISOString(),
  status: '修订版仅准备，未获本批业务写入授权',
  policy: {
    businessWrites: 0,
    apiCalls: 0,
    method: '仅生成POST意图，不执行请求',
    endpoint: 'http://127.0.0.1:8080/api/admin/games/lol',
    bearer: '由开发环境提供；不在文件中保存认证值'
  },
  scope: candidate.meta.scope,
  source: 'client16.17/official16.17.1',
  candidateFile,
  candidateSha256: createHash('sha256').update(candidateBytes).digest('hex'),
  candidatePlanSha256: createHash('sha256').update(JSON.stringify(candidate)).digest('hex'),
  snapshotSha256: createHash('sha256').update(snapshotBytes).digest('hex'),
  protectionFile,
  protectionSha256: createHash('sha256').update(protectionBytes).digest('hex'),
  currentGet: snapshot.summary,
  protectedReadOnly: { characters: 4, characterSkillRelations: 4, representativeImages: 20, apiWrites: 0 },
  reusedPublicParameters: reused,
  counts,
  requestCount: requests.length,
  requests,
  historicalCandidatePreserved: true,
  historicalPlan: '写前计划.json'
};
fs.writeFileSync(new URL('写前计划-修订版.json', here), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, requestCount: report.requestCount, counts, reusedPublicParameters: reused.length, apiCalls: 0, businessWrites: 0, candidateSha256: report.candidateSha256 }, null, 2));
